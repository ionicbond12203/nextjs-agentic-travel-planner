import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

async function testRedis() {
  try {
    console.log('Connecting to Redis...');
    await redis.set('test_key', 'hello_redis');
    const val = await redis.get('test_key');
    console.log('Redis test:', val === 'hello_redis' ? 'SUCCESS' : 'FAILED');
    await redis.del('test_key');
    process.exit(0);
  } catch (error) {
    console.error('Redis connection failed:', error);
    process.exit(1);
  }
}

testRedis();
