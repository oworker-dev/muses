import { createHash, randomUUID } from "node:crypto"
import type { PoolClient } from "pg"

import { getAuthSecret } from "@/lib/auth"
import { getPgPool } from "@/lib/database"

export type AnalyticsEventInput = {
  eventName: string
  path: string
  feature?: string | null
  referrer?: string | null
  device?: string | null
  country?: string | null
  userId?: string | null
  sessionId?: string | null
}

export type AnalyticsSummary = {
  since: string
  until: string
  pageViews: number
  uniqueVisitors: number
  signedInVisitors: number
  activeVisitors: number
  topPaths: Array<{ path: string; count: number }>
  topFeatures: Array<{ feature: string; count: number }>
  devices: Array<{ device: string; count: number }>
  countries: Array<{ country: string; count: number }>
  dailyTrend: Array<{ date: string; pageViews: number }>
}

export async function recordAnalyticsEvent(input: AnalyticsEventInput) {
  const eventName = normalizeName(input.eventName, "page_view")
  const path = normalizePath(input.path)
  const feature = normalizeDimension(input.feature, "none", 120)
  const referrer = normalizeOptional(input.referrer, 260)
  const device = normalizeDimension(input.device, "unknown", 80)
  const country = normalizeCountry(input.country)
  const userIdHash = input.userId ? hashAnalyticsId(input.userId) : null
  const sessionIdHash = input.sessionId ? hashAnalyticsId(input.sessionId) : null
  const authenticated = Boolean(userIdHash)

  if (!sessionIdHash) {
    throw new Error("Analytics session id is required.")
  }

  const client = await getPgPool().connect()
  try {
    await client.query("begin")
    await client.query(
      `
        insert into analytics_event (
          id,
          event_name,
          path,
          feature,
          referrer,
          device,
          country,
          user_id_hash,
          session_id_hash
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        randomUUID(),
        eventName,
        path,
        feature === "none" ? null : feature,
        referrer,
        device,
        country,
        userIdHash,
        sessionIdHash,
      ]
    )
    await upsertRollup(client, {
      eventName,
      path,
      feature,
      device,
      country,
      authenticated,
    })
    await upsertVisitorActivity(client, {
      sessionIdHash,
      userIdHash,
      authenticated,
      device,
      country,
    })

    if (input.userId && userIdHash) {
      await upsertAccountActivity(client, {
        userId: input.userId,
        userIdHash,
        eventName,
        path,
        device,
        country,
      })
    }

    await client.query("commit")
  } catch (error) {
    await client.query("rollback").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function getAnalyticsSummary(days = 7): Promise<AnalyticsSummary> {
  const safeDays = Math.min(Math.max(days, 1), 90)
  const pool = getPgPool()

  const [bounds, totals, visitors, activeVisitors, topPaths, topFeatures, devices, countries, dailyTrend] =
    await Promise.all([
      pool.query<BoundsRow>(
        `
          select
            (current_date - ($1::int - 1))::timestamptz as since,
            now() as until
        `,
        [safeDays]
      ),
      pool.query<TotalsRow>(
        `
          select coalesce(sum(event_count), 0)::int as "pageViews"
          from analytics_daily_rollup
          where bucket_date >= current_date - ($1::int - 1)
            and event_name = 'page_view'
        `,
        [safeDays]
      ),
      pool.query<VisitorsRow>(
        `
          select
            count(distinct session_id_hash)::int as "uniqueVisitors",
            (count(distinct user_id_hash) filter (where user_id_hash is not null))::int as "signedInVisitors"
          from analytics_daily_visitor
          where bucket_date >= current_date - ($1::int - 1)
        `,
        [safeDays]
      ),
      pool.query<ActiveVisitorsRow>(
        `
          select count(*)::int as "activeVisitors"
          from analytics_visitor_activity
          where last_seen_at > now() - interval '5 minutes'
        `
      ),
      pool.query<CountRow>(
        `
          select path, coalesce(sum(event_count), 0)::int as count
          from analytics_daily_rollup
          where bucket_date >= current_date - ($1::int - 1)
            and event_name = 'page_view'
          group by path
          order by count desc, path asc
          limit 8
        `,
        [safeDays]
      ),
      pool.query<FeatureCountRow>(
        `
          select
            case when feature = 'none' then event_name else feature end as feature,
            coalesce(sum(event_count), 0)::int as count
          from analytics_daily_rollup
          where bucket_date >= current_date - ($1::int - 1)
          group by case when feature = 'none' then event_name else feature end
          order by count desc, feature asc
          limit 8
        `,
        [safeDays]
      ),
      pool.query<DeviceCountRow>(
        `
          select device, coalesce(sum(event_count), 0)::int as count
          from analytics_daily_rollup
          where bucket_date >= current_date - ($1::int - 1)
          group by device
          order by count desc, device asc
          limit 8
        `,
        [safeDays]
      ),
      pool.query<CountryCountRow>(
        `
          select country, coalesce(sum(event_count), 0)::int as count
          from analytics_daily_rollup
          where bucket_date >= current_date - ($1::int - 1)
          group by country
          order by count desc, country asc
          limit 8
        `,
        [safeDays]
      ),
      pool.query<TrendRow>(
        `
          select bucket_date::text as date, coalesce(sum(event_count), 0)::int as "pageViews"
          from analytics_daily_rollup
          where bucket_date >= current_date - ($1::int - 1)
            and event_name = 'page_view'
          group by bucket_date
          order by bucket_date asc
        `,
        [safeDays]
      ),
    ])
  const boundsRow = bounds.rows[0]
  const total = totals.rows[0]
  const visitorTotals = visitors.rows[0]
  const active = activeVisitors.rows[0]

  return {
    since: new Date(boundsRow?.since || Date.now()).toISOString(),
    until: new Date(boundsRow?.until || Date.now()).toISOString(),
    pageViews: Number(total?.pageViews || 0),
    uniqueVisitors: Number(visitorTotals?.uniqueVisitors || 0),
    signedInVisitors: Number(visitorTotals?.signedInVisitors || 0),
    activeVisitors: Number(active?.activeVisitors || 0),
    topPaths: topPaths.rows.map((row) => ({ path: row.path, count: Number(row.count) })),
    topFeatures: topFeatures.rows.map((row) => ({
      feature: row.feature,
      count: Number(row.count),
    })),
    devices: devices.rows.map((row) => ({ device: row.device, count: Number(row.count) })),
    countries: countries.rows.map((row) => ({ country: row.country, count: Number(row.count) })),
    dailyTrend: dailyTrend.rows.map((row) => ({
      date: row.date,
      pageViews: Number(row.pageViews),
    })),
  }
}

async function upsertRollup(
  client: PoolClient,
  input: {
    eventName: string
    path: string
    feature: string
    device: string
    country: string
    authenticated: boolean
  }
) {
  await client.query(
    `
      insert into analytics_daily_rollup (
        bucket_date,
        event_name,
        path,
        feature,
        device,
        country,
        authenticated,
        event_count
      )
      values (current_date, $1, $2, $3, $4, $5, $6, 1)
      on conflict (bucket_date, event_name, path, feature, device, country, authenticated)
      do update set event_count = analytics_daily_rollup.event_count + 1,
                    updated_at = now()
    `,
    [input.eventName, input.path, input.feature, input.device, input.country, input.authenticated]
  )

  await client.query(
    `
      insert into analytics_hourly_rollup (
        bucket_start,
        event_name,
        path,
        feature,
        device,
        country,
        authenticated,
        event_count
      )
      values (date_trunc('hour', now()), $1, $2, $3, $4, $5, $6, 1)
      on conflict (bucket_start, event_name, path, feature, device, country, authenticated)
      do update set event_count = analytics_hourly_rollup.event_count + 1,
                    updated_at = now()
    `,
    [input.eventName, input.path, input.feature, input.device, input.country, input.authenticated]
  )
}

async function upsertVisitorActivity(
  client: PoolClient,
  input: {
    sessionIdHash: string
    userIdHash: string | null
    authenticated: boolean
    device: string
    country: string
  }
) {
  await client.query(
    `
      insert into analytics_daily_visitor (
        bucket_date,
        session_id_hash,
        user_id_hash,
        authenticated,
        country,
        device
      )
      values (current_date, $1, $2, $3, $4, $5)
      on conflict (bucket_date, session_id_hash)
      do update set user_id_hash = coalesce(excluded.user_id_hash, analytics_daily_visitor.user_id_hash),
                    authenticated = analytics_daily_visitor.authenticated or excluded.authenticated,
                    country = excluded.country,
                    device = excluded.device,
                    last_seen_at = now()
    `,
    [input.sessionIdHash, input.userIdHash, input.authenticated, input.country, input.device]
  )

  await client.query(
    `
      insert into analytics_visitor_activity (
        session_id_hash,
        user_id_hash,
        authenticated,
        last_country,
        last_device
      )
      values ($1, $2, $3, $4, $5)
      on conflict (session_id_hash)
      do update set user_id_hash = coalesce(excluded.user_id_hash, analytics_visitor_activity.user_id_hash),
                    authenticated = analytics_visitor_activity.authenticated or excluded.authenticated,
                    last_seen_at = now(),
                    last_country = excluded.last_country,
                    last_device = excluded.last_device,
                    updated_at = now()
    `,
    [input.sessionIdHash, input.userIdHash, input.authenticated, input.country, input.device]
  )
}

async function upsertAccountActivity(
  client: PoolClient,
  input: {
    userId: string
    userIdHash: string
    eventName: string
    path: string
    device: string
    country: string
  }
) {
  await client.query(
    `
      insert into account_activity_summary (
        user_id,
        user_id_hash,
        last_country,
        last_device,
        last_path,
        last_event_name
      )
      values ($1, $2, $3, $4, $5, $6)
      on conflict (user_id)
      do update set user_id_hash = excluded.user_id_hash,
                    last_seen_at = now(),
                    last_country = excluded.last_country,
                    last_device = excluded.last_device,
                    last_path = excluded.last_path,
                    last_event_name = excluded.last_event_name,
                    updated_at = now()
    `,
    [input.userId, input.userIdHash, input.country, input.device, input.path, input.eventName]
  )
}

function hashAnalyticsId(value: string) {
  return createHash("sha256")
    .update(getAuthSecret())
    .update(":")
    .update(value)
    .digest("hex")
}

function normalizeName(value: string, fallback: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._:-]+/g, "_")
      .slice(0, 80) || fallback
  )
}

function normalizePath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/"
  }

  return value.slice(0, 260)
}

function normalizeDimension(value: string | null | undefined, fallback: string, max = 120) {
  return normalizeOptional(value, max) || fallback
}

function normalizeCountry(value: string | null | undefined) {
  const country = normalizeOptional(value, 80)
  if (!country) {
    return "unknown"
  }
  return country.toUpperCase()
}

function normalizeOptional(value?: string | null, max = 120) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

type BoundsRow = {
  since: Date | string
  until: Date | string
}

type TotalsRow = {
  pageViews: number
}

type VisitorsRow = {
  uniqueVisitors: number
  signedInVisitors: number
}

type ActiveVisitorsRow = {
  activeVisitors: number
}

type CountRow = {
  path: string
  count: number
}

type FeatureCountRow = {
  feature: string
  count: number
}

type DeviceCountRow = {
  device: string
  count: number
}

type CountryCountRow = {
  country: string
  count: number
}

type TrendRow = {
  date: string
  pageViews: number
}
