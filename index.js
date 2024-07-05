const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const app = express();
const port = 3000;

dotenv.config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

app.use(bodyParser.json());

app.get('/reviews', async (req, res) => {
  const { page = 1, count = 5, sort = 'newest', product_id } = req.query;

  if (!product_id) {
    return res.status(400).send('product_id is required');
  }

  try {
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

    res.status(200).json({
      product: product_id,
      page: parseInt(page) - 1,
      count: parseInt(count),
      results: reviewsWithPhotos,
    });
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

  try {
    const result = await pool.query(
      `SELECT * FROM get_review_meta($1)`,
      [parseInt(product_id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).send('No metadata found for this product.');
    }

    const meta = result.rows[0];

    res.status(200).json({
      product_id: meta.product_id.toString(),
      ratings: meta.ratings,
      recommended: meta.recommended,
      characteristics: meta.characteristics,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/reviews', async (req, res) => {
  const { product_id, rating, summary, body, recommend, name, email, photos, characteristics } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO reviews (product_id, rating, date, summary, body, recommend, reported, reviewer_name, reviewer_email, helpfulness)
       VALUES ($1, $2, NOW(), $3, $4, $5, FALSE, $6, $7, 0)
       RETURNING id`,
      [product_id, rating, summary, body, recommend, name, email]
    );

    const review_id = result.rows[0].id;

    if (photos && photos.length > 0) {
      const photoQueries = photos.map(url => pool.query(
        `INSERT INTO review_photos (review_id, url) VALUES ($1, $2)`,
        [review_id, url]
      ));

      await Promise.all(photoQueries);
    }

    if (characteristics) {
      const characteristicQueries = Object.entries(characteristics).map(([id, value]) => pool.query(
        `INSERT INTO characteristic_reviews (characteristic_id, review_id, value) VALUES ($1, $2, $3)`,
        [id, review_id, value]
      ));

      await Promise.all(characteristicQueries);
    }

    res.status(201).send('Review Created');
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.put('/reviews/:review_id/helpful', async (req, res) => {
  const { review_id } = req.params;

  try {
    await pool.query(
      `UPDATE reviews SET helpfulness = helpfulness + 1 WHERE id = $1`,
      [review_id]
    );

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.put('/reviews/:review_id/report', async (req, res) => {
  const { review_id } = req.params;

  try {
    await pool.query(
      `UPDATE reviews SET reported = TRUE WHERE id = $1`,
      [review_id]
    );

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});
