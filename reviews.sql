CREATE TABLE reviews (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5) NOT NULL,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    summary TEXT,
    body TEXT,
    recommend BOOLEAN,
    reported BOOLEAN,
    reviewer_name TEXT,
    reviewer_email TEXT,
    response TEXT DEFAULT NULL,
    helpfulness INTEGER DEFAULT 0
);

CREATE TABLE raw_reviews (
    id SERIAL PRIMARY KEY,
    product_id INTEGER,
    rating INTEGER,
    date BIGINT,
    summary TEXT,
    body TEXT,
    recommend BOOLEAN,
    reported BOOLEAN,
    reviewer_name TEXT,
    reviewer_email TEXT,
    response TEXT,
    helpfulness INTEGER
);

COPY raw_reviews(id, product_id, rating, date, summary, body, recommend, reported, reviewer_name, reviewer_email, response, helpfulness)
FROM '/Users/michaeltrofimov/reviews/reviews.csv' DELIMITER ',' CSV HEADER;



INSERT INTO reviews (id, product_id, rating, date, summary, body, recommend, reported, reviewer_name, reviewer_email, response, helpfulness)
SELECT id, product_id, rating, to_timestamp(date / 1000)::timestamp AT TIME ZONE 'UTC', summary, body, recommend, reported, reviewer_name, reviewer_email, response, helpfulness
FROM raw_reviews;

CREATE TABLE review_photos (
    id SERIAL PRIMARY KEY,
    review_id INTEGER REFERENCES reviews(id),
    url TEXT NOT NULL
);

COPY review_photos(id, review_id, url)
FROM '/Users/michaeltrofimov/reviews/reviews_photos.csv' DELIMITER ',' CSV HEADER;

CREATE TABLE characteristics (
    id SERIAL PRIMARY KEY,
    product_id INTEGER,
    name TEXT NOT NULL
    );
COPY characteristics(id, product_id, name)
FROM '/Users/michaeltrofimov/reviews/characteristics.csv' DELIMITER ',' CSV HEADER;

CREATE TABLE characteristic_reviews (
    id SERIAL PRIMARY KEY,
    characteristic_id INTEGER REFERENCES characteristics(id),
    review_id INTEGER REFERENCES reviews(id),
    value TEXT NOT NULL
);

COPY characteristic_reviews(id, characteristic_id, review_id, value)
FROM '/Users/michaeltrofimov/reviews/characteristic_reviews.csv' DELIMITER ',' CSV HEADER;

CREATE OR REPLACE FUNCTION getReviews(page INT, count INT, sort TEXT, product_id INT)
RETURNS TABLE(
    id INTEGER,
    product_id INTEGER,
    rating INTEGER,
    date TIMESTAMP WITH TIME ZONE,
    summary TEXT,
    body TEXT,
    recommend BOOLEAN,
    reported BOOLEAN,
    reviewer_name TEXT,
    reviewer_email TEXT,
    response TEXT,
    helpfulness INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    id,
    product_id,
    rating,
    date,
    summary,
    body,
    recommend,
    reported,
    reviewer_name,
    reviewer_email,
    response,
    helpfulness
  FROM reviews
  WHERE reviews.product_id = $4
  ORDER BY
    CASE
      WHEN $3 = 'helpfulness' THEN reviews.helpfulness
      WHEN $3 = 'newness' THEN reviews.date
      WHEN $3 = 'relevant' THEN reviews.date + reviews.helpfulness * interval '1 second'
      ELSE reviews.id
    END DESC
  OFFSET ($1 - 1) * $2 ROWS FETCH FIRST $2 ROWS ONLY;
END;
$$ LANGUAGE PLPGSQL;
SELECT * FROM getReviews(1, 1, 5);