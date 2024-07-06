const cluster = require('cluster');
const os = require('os');
const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const redis = require('redis');
const genericPool = require('generic-pool');

dotenv.config();

const numCPUs = os.cpus().length;

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork(); // Ensure a new worker starts if one dies
  });
} else {
  const app = express();
  const port = 3000;
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const redisClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT
});

redisClient.connect().catch(console.error);

redisClient.on('error', (err) => {
  console.error('Redis error: ', err);
});

app.use(bodyParser.json());

app.get('/reviews', async (req, res) => {
  const { page = 1, count = 5, sort = 'newest', product_id } = req.query;

  if (!product_id) {
    return res.status(400).send('product_id is required');
  }

  const cacheKey = `reviews:${product_id}:${page}:${count}:${sort}`;
  try {
    const cachedReviews = await redisClient.get(cacheKey);
    if (cachedReviews) {
      return res.status(200).json(JSON.parse(cachedReviews));
    }

    const result = await pool.query(
      `SELECT * FROM getReviews($1, $2, $3, $4)`,
      [parseInt(page), parseInt(count), sort, parseInt(product_id)]
    );

    const reviews = result.rows;
    const reviewIds = reviews.map(review => review.id);

    const photosResult = await pool.query(
      `SELECT * FROM review_photos WHERE review_id = ANY($1::int[])`,
      [reviewIds]
    );

    const photos = photosResult.rows;

    const reviewsWithPhotos = reviews.map(review => ({
      ...review,
      photos: photos.filter(photo => photo.review_id === review.id)
    }));

    const response = {
      product: product_id,
      page: parseInt(page) - 1,
      count: parseInt(count),
      results: reviewsWithPhotos,
    };

    await redisClient.set(cacheKey, JSON.stringify(response), 'EX', 3600); // Cache for 1 hour

    res.status(200).json(response);
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/reviews/meta', async (req, res) => {
  const { product_id } = req.query;

  if (!product_id) {
    return res.status(400).send('product_id is required');
  }

  const cacheKey = `review_meta:${product_id}`;
  try {
    const cachedMeta = await redisClient.get(cacheKey);
    if (cachedMeta) {
      return res.status(200).json(JSON.parse(cachedMeta));
    }

    const result = await pool.query(
      `SELECT * FROM get_review_meta($1)`,
      [parseInt(product_id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('No metadata found for this product.');
    }

    const meta = result.rows[0];

    const response = {
      product_id: meta.product_id.toString(),
      ratings: meta.ratings,
      recommended: meta.recommended,
      characteristics: meta.characteristics,
    };

    await redisClient.set(cacheKey, JSON.stringify(response), 'EX', 3600); // Cache for 1 hour

    res.status(200).json(response);
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/reviews', async (req, res) => {
  const { product_id, rating, summary, body, recommend, name, email, photos, characteristics } = req.body;

  if (product_id == null || rating == null || summary == null || body == null || recommend == null || name == null || email == null) {
    return res.status(400).send('Missing required fields');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const reviewResult = await client.query(
      `INSERT INTO reviews (product_id, rating, date, summary, body, recommend, reported, reviewer_name, reviewer_email, helpfulness)
       VALUES ($1, $2, NOW(), $3, $4, $5, FALSE, $6, $7, 0)
       RETURNING id`,
      [product_id, rating, summary, body, recommend, name, email]
    );

    const review_id = reviewResult.rows[0].id;

    if (photos && photos.length > 0) {
      const photoQueries = photos.map(url => client.query(
        `INSERT INTO review_photos (review_id, url) VALUES ($1, $2)`,
        [review_id, url]
      ));
      await Promise.all(photoQueries);
    }

    if (characteristics) {
      const characteristicQueries = Object.entries(characteristics).map(([id, value]) => client.query(
        `INSERT INTO characteristic_reviews (characteristic_id, review_id, value) VALUES ($1, $2, $3)`,
        [id, review_id, value]
      ));
      await Promise.all(characteristicQueries);
    }

    await client.query('COMMIT');

    // Clear relevant cache
    await redisClient.del(`reviews:${product_id}:*`);
    await redisClient.del(`review_meta:${product_id}`);

    res.status(201).json({ id: review_id, message: 'Review Created' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating review:', error);
    res.status(500).send('Internal Server Error');
  } finally {
    client.release();
  }
});

app.put('/reviews/:review_id/helpful', async (req, res) => {
  const { review_id } = req.params;

  try {
    const reviewResult = await pool.query(
      `UPDATE reviews SET helpfulness = helpfulness + 1 WHERE id = $1 RETURNING product_id`,
      [review_id]
    );

    const product_id = reviewResult.rows[0].product_id;

    // Clear relevant cache
    await redisClient.del(`reviews:${product_id}:*`);
    await redisClient.del(`review_meta:${product_id}`);

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.put('/reviews/:review_id/report', async (req, res) => {
  const { review_id } = req.params;

  try {
    const reviewResult = await pool.query(
      `UPDATE reviews SET reported = TRUE WHERE id = $1 RETURNING product_id`,
      [review_id]
    );

    const product_id = reviewResult.rows[0].product_id;

    // Clear relevant cache
    await redisClient.del(`reviews:${product_id}:*`);
    await redisClient.del(`review_meta:${product_id}`);

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
}