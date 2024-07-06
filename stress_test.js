import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend } from 'k6/metrics';

// Custom metrics to capture response times
let getReviewsTrend = new Trend('get_reviews_response_time');
let getReviewsMetaTrend = new Trend('get_reviews_meta_response_time');
let postReviewsTrend = new Trend('post_reviews_response_time');
let putHelpfulTrend = new Trend('put_helpful_response_time');
let putReportTrend = new Trend('put_report_response_time');

export let options = {
  stages: [
    { duration: '10s', target: 1 },
    { duration: '10s', target: 10 },
    { duration: '10s', target: 100 },
    { duration: '10s', target: 1000 }
  ],
};

export default function () {
  group('GET /reviews', function () {
    let res = http.get('http://localhost:3000/reviews?product_id=1&sort=newness&page=1&count=10');
    getReviewsTrend.add(res.timings.duration);
    check(res, {
      'status is 200': (r) => r.status === 200,
      'response time < 50ms': (r) => r.timings.duration < 50,
    });
    sleep(1);
  });

  group('GET /reviews/meta', function () {
    let res = http.get('http://localhost:3000/reviews/meta?product_id=1');
    getReviewsMetaTrend.add(res.timings.duration);
    check(res, {
      'status is 200': (r) => r.status === 200,
      'response time < 50ms': (r) => r.timings.duration < 50,
    });
    sleep(1);
  });

  group('POST /reviews', function () {
    const payload = JSON.stringify({
      product_id: 1,
      rating: 5,
      summary: "Great product!",
      body: "I really enjoyed using this product. Highly recommended!",
      recommend: true,
      name: "John Doe",
      email: "john.doe@example.com",
      photos: ["http://example.com/photo1.jpg", "http://example.com/photo2.jpg"],
      characteristics: {
        1: 5,
        2: 4,
      }
    });

    const params = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    let res = http.post('http://localhost:3000/reviews', payload, params);
    postReviewsTrend.add(res.timings.duration);
    check(res, {
      'status is 201': (r) => r.status === 201,
      'response time < 50ms': (r) => r.timings.duration < 50,
    });
    sleep(1);
  });

  group('PUT /reviews/:review_id/helpful', function () {
    let res = http.put('http://localhost:3000/reviews/1/helpful');
    putHelpfulTrend.add(res.timings.duration);
    check(res, {
      'status is 204': (r) => r.status === 204,
      'response time < 50ms': (r) => r.timings.duration < 50,
    });
    sleep(1);
  });

  group('PUT /reviews/:review_id/report', function () {
    let res = http.put('http://localhost:3000/reviews/1/report');
    putReportTrend.add(res.timings.duration);
    check(res, {
      'status is 204': (r) => r.status === 204,
      'response time < 50ms': (r) => r.timings.duration < 50,
    });
    sleep(1);
  });
}
