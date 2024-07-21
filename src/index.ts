import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis/cloudflare'
import { type Env, Hono } from 'hono'
import { env } from 'hono/adapter'
import type { Context } from 'hono/jsx'
import type { BlankInput } from 'hono/types'
import { todos } from './data/data.json'

declare module 'hono' {
  interface ContextVariableMap {
    ratelimit: Ratelimit
  }
}

const app = new Hono()

const cache = new Map()

// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
class RedisRatelimiter {
  static instance: Ratelimit

  static getInstance(c: Context<Env, '/todos/:id', BlankInput>) {
    if (!RedisRatelimiter.instance) {
      const { REDIS_URL, REDIS_TOKEN } = env<{
        REDIS_URL: string
        REDIS_TOKEN: string
      }>(c)
      const redisClient = new Redis({
        token: REDIS_TOKEN,
        url: REDIS_URL,
      })

      const ratelimit = new Ratelimit({
        redis: redisClient,
        limiter: Ratelimit.slidingWindow(10, '10 s'),
        ephemeralCache: cache,
      })
      RedisRatelimiter.instance = ratelimit
    } else {
      return RedisRatelimiter.instance
    }
  }
}

app.use(async (c, next) => {
  const ratelimit = RedisRatelimiter.getInstance(c)
  c.set('ratelimit', ratelimit)
  await next()
})
app.get('/todos/:id', async (c) => {
  const ratelimit = c.get('ratelimit')
  const ip = c.req.raw.headers.get('CF-Connecting-IP')

  const { success } = await ratelimit.limit(ip ?? 'anonymous')

  if (success) {
    const todoId = c.req.param('id')
    const todoIndex = Number(todoId)
    const todo = todos[todoIndex] || {}

    return c.json(todo)
    // biome-ignore lint/style/noUselessElse: <explanation>
  } else {
    return c.json({ message: 'Too many request' }, { status: 429 })
  }
})

export default app
