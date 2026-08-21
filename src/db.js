// Simple dependency-free JSON data store.
// One process owns the file, so synchronous read + atomic write is safe and
// avoids any native build step (better for Railway / Render / etc).

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

const DB_PATH = process.env.DATABASE_PATH || './data/db.json';

// Make sure the folder exists.
const dir = dirname(DB_PATH);
if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

const DEFAULT_CONFIG = {
  officer_role: null,
  hicom_role: null,
  upper_hicom_role: null,
  overseer_role: null,
  member_role: null,
  inactivity_notice_role: null,
  quota_excuse_role: null,
  strike1_role: null,
  strike2_role: null,
  strike3_role: null,
  strike4_role: null,
  ep_log_channel: null,
  op_log_channel: null,
  ep_quota: 0,
  op_quota: 0,
};

const CONFIG_FIELDS = new Set(Object.keys(DEFAULT_CONFIG));

// Shape on disk: { guilds: { [guildId]: { config: {...}, points: { [userId]: {ep, op} } } } }
let data = { guilds: {} };

function load() {
  if (existsSync(DB_PATH)) {
    try {
      data = JSON.parse(readFileSync(DB_PATH, 'utf8')) || { guilds: {} };
      if (!data.guilds) data.guilds = {};
    } catch (e) {
      console.error('Could not parse db.json, starting fresh:', e.message);
      data = { guilds: {} };
    }
  }
}

function save() {
  // Atomic write: write to a temp file then rename over the real one.
  const tmp = DB_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, DB_PATH);
}

load();

function guild(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = { config: { ...DEFAULT_CONFIG }, points: {} };
  }
  // Backfill any new config keys added in later versions.
  const cfg = data.guilds[guildId].config;
  for (const k of CONFIG_FIELDS) if (!(k in cfg)) cfg[k] = DEFAULT_CONFIG[k];
  return data.guilds[guildId];
}

// ---------- Config ----------

export function getConfig(guildId) {
  return { ...guild(guildId).config };
}

export function setConfigField(guildId, field, value) {
  if (!CONFIG_FIELDS.has(field)) throw new Error('Invalid config field: ' + field);
  guild(guildId).config[field] = value;
  save();
}

// ---------- Points ----------

export function getPoints(guildId, userId) {
  const p = guild(guildId).points[userId];
  return { ep: p?.ep || 0, op: p?.op || 0, xp: p?.xp || 0 };
}

// field is 'ep', 'op', or 'xp'. Returns the new record.
export function addPoints(guildId, userId, field, amount) {
  const col = ['ep', 'op', 'xp'].includes(field) ? field : 'ep';
  const g = guild(guildId);
  if (!g.points[userId]) g.points[userId] = { ep: 0, op: 0, xp: 0 };
  g.points[userId][col] = (g.points[userId][col] || 0) + amount;
  save();
  return { ...g.points[userId] };
}

// Add to several fields at once (one write). deltas = { ep?, op?, xp? }.
export function addPointsMulti(guildId, userId, deltas) {
  const g = guild(guildId);
  if (!g.points[userId]) g.points[userId] = { ep: 0, op: 0, xp: 0 };
  for (const f of ['ep', 'op', 'xp']) {
    if (deltas[f]) g.points[userId][f] = (g.points[userId][f] || 0) + deltas[f];
  }
  save();
  return { ...g.points[userId] };
}

// Returns [{ userId, ep }] sorted desc, only nonzero, capped at limit.
export function getTopEp(guildId, limit) {
  const points = guild(guildId).points;
  return Object.entries(points)
    .map(([userId, p]) => ({ userId, ep: p.ep || 0 }))
    .filter((r) => r.ep !== 0)
    .sort((a, b) => b.ep - a.ep)
    .slice(0, limit);
}

// Returns [{ userId, ep, op, xp }] for everyone with a record.
export function getAllPoints(guildId) {
  const points = guild(guildId).points;
  return Object.entries(points).map(([userId, p]) => ({
    userId,
    ep: p.ep || 0,
    op: p.op || 0,
    xp: p.xp || 0,
  }));
}

// Sets the given field to 0 for everyone. field is 'ep' or 'op'.
export function resetField(guildId, field) {
  const col = field === 'op' ? 'op' : 'ep';
  const points = guild(guildId).points;
  for (const id of Object.keys(points)) points[id][col] = 0;
  save();
}

// ---------- Ranks ----------
// Stored on the guild config as an array of { role: roleId, xp: number }.

export function getRanks(guildId) {
  const r = guild(guildId).config.ranks;
  return Array.isArray(r) ? r.map((x) => ({ role: x.role, xp: Number(x.xp) || 0 })) : [];
}

export function setRanks(guildId, ranks) {
  guild(guildId).config.ranks = ranks.map((x) => ({ role: x.role, xp: Number(x.xp) || 0 }));
  save();
}

// ---------- Group ranking config ----------
// Stored on the guild config under `grouprank`. Defaults match the requested
// server so it works out of the box; /groupapi setup can override any of it.

const GROUP_DEFAULTS = {
  group_id: '367883697',
  resolver_channel: '1540172573206253639',
  resolver_bot_id: '1419470533371625472',
  log_channel_1: '1490877177342984243',
  log_channel_2: '1540176007733059664',
  hicom_role: null, // falls back to main config hicom_role if left null
  uh_role: null, // falls back to main config upper_hicom_role if left null
  staff_role: null,
  superuser_id: '710900729870811177',
  hicom_max: 150,
  uh_max: 162,
  staff_max: 200,
  min_rank: 2,
};

const GROUP_FIELDS = new Set(Object.keys(GROUP_DEFAULTS));

export function getGroupConfig(guildId) {
  const stored = guild(guildId).config.grouprank || {};
  const merged = { ...GROUP_DEFAULTS, ...stored };
  merged.log_channels = [merged.log_channel_1, merged.log_channel_2].filter(Boolean);
  return merged;
}

export function setGroupField(guildId, field, value) {
  if (!GROUP_FIELDS.has(field)) throw new Error('Invalid group field: ' + field);
  const g = guild(guildId);
  if (!g.config.grouprank) g.config.grouprank = {};
  g.config.grouprank[field] = value;
  save();
}
