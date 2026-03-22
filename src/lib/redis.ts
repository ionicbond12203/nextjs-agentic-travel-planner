import Redis from 'ioredis';
import { DialogueState } from './dialogue-state';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  tls: redisUrl.startsWith('rediss://') ? {} : undefined,
});

export async function getSession(sessionId: string): Promise<DialogueState | null> {
  try {
    const data = await redis.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('[Redis] Get session failed:', error);
    return null;
  }
}

export async function setSession(sessionId: string, state: DialogueState): Promise<void> {
  try {
    // 默认过期时间 24 小时
    await redis.set(`session:${sessionId}`, JSON.stringify(state), 'EX', 86400);
  } catch (error) {
    console.error('[Redis] Set session failed:', error);
  }
}

export default redis;
