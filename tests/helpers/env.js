// Loaded by Jest before every test file (see "setupFiles" in package.json).
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-1234567890';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://placeholder-overridden-by-tests';
process.env.BCRYPT_ROUNDS = '4';
process.env.LOGIN_RATE_LIMIT = '1000';
process.env.AI_RATE_LIMIT_PER_MINUTE = '1000';
process.env.AI_API_KEY = '';
process.env.APP_BASE_URL = 'http://localhost:5000';
process.env.LOG_LEVEL = 'silent';
