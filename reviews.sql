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

CREATE OR REPLACE FUNCTION getReviews(page INT, count INT, sort TEXT, prod_id INT)
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
    r.id,
    r.product_id,
    r.rating,
    r.date,
    r.summary,
    r.body,
    r.recommend,
    r.reported,
    r.reviewer_name,
    r.reviewer_email,
    r.response,
    r.helpfulness
  FROM reviews r
  WHERE r.product_id = $4
  ORDER BY
    CASE
      WHEN $3 = 'helpfulness' THEN r.helpfulness
      WHEN $3 = 'newness' THEN EXTRACT(EPOCH FROM r.date)
      WHEN $3 = 'relevant' THEN EXTRACT(EPOCH FROM r.date) + r.helpfulness
      ELSE r.id
    END DESC
  LIMIT $2 OFFSET ($1 - 1) * $2;
END;
$$ LANGUAGE PLPGSQL;

SELECT * FROM getReviews(1, 1, 5);

CREATE OR REPLACE FUNCTION get_review_meta(p_product_id INT)
RETURNS TABLE(
    product_id INT,
    ratings JSONB,
    recommended JSONB,
    characteristics JSONB
) AS $$
BEGIN
    RETURN QUERY
    WITH ratings_cte AS (
        SELECT rating, COUNT(*) as count
        FROM reviews
        WHERE reviews.product_id = p_product_id
        GROUP BY rating
    ),
    recommended_cte AS (
        SELECT recommend, COUNT(*) as count
        FROM reviews
        WHERE reviews.product_id = p_product_id
        GROUP BY recommend
    ),
    characteristics_cte AS (
        SELECT c.name, cr.characteristic_id, AVG(cr.value) as value
        FROM characteristics c
        JOIN characteristic_reviews cr ON c.id = cr.characteristic_id
        WHERE c.product_id = p_product_id
        GROUP BY c.name, cr.characteristic_id
    )
    SELECT
        p_product_id AS product_id,
        (SELECT jsonb_object_agg(rating, count) FROM ratings_cte) AS ratings,
        (SELECT jsonb_object_agg(recommend, count) FROM recommended_cte) AS recommended,
        (SELECT jsonb_object_agg(name, jsonb_build_object('id', characteristic_id, 'value', value)) FROM characteristics_cte) AS characteristics;
END;
$$ LANGUAGE plpgsql;

CREATE INDEX idx_reviews_product_id ON reviews(product_id);
CREATE INDEX idx_reviews_date ON reviews(date);
CREATE INDEX idx_reviews_helpfulness ON reviews(helpfulness);
CREATE INDEX idx_review_photos_review_id ON review_photos(review_id);
CREATE INDEX idx_characteristics_product_id ON characteristics(product_id);
CREATE INDEX idx_characteristic_reviews_characteristic_id ON characteristic_reviews(characteristic_id);
CREATE INDEX idx_characteristic_reviews_review_id ON characteristic_reviews(review_id);
