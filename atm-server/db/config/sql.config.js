import mysql from 'mysql2/promise';
import fs from 'fs';

let pool;
let schemaReady;

const getDatabaseUrl = () => process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.SQL_URL || '';

const createPool = () => {
  const url = getDatabaseUrl().trim();
  if (!url) throw new Error('DATABASE_URL_MISSING');

  const sslRequired = /ssl(mode)?=required/i.test(url) || process.env.MYSQL_SSL === 'true';
  const ca = process.env.SQL_CA_CERT
    || (process.env.SQL_CA_CERT_PATH ? fs.readFileSync(process.env.SQL_CA_CERT_PATH, 'utf8') : undefined);
  return mysql.createPool({
    uri: url,
    waitForConnections: true,
    connectionLimit: Number(process.env.SQL_CONNECTION_LIMIT || 5),
    queueLimit: 0,
    ssl: sslRequired ? { ca, rejectUnauthorized: Boolean(ca) } : undefined,
  });
};

export const getPool = () => {
  if (!pool) pool = createPool();
  return pool;
};

const ddl = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    name VARCHAR(255) NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    otp VARCHAR(16) NULL,
    expireOtpAt DATETIME NULL,
    role ENUM('operator','user','admin','superadmin') NOT NULL DEFAULT 'user',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    \`key\` VARCHAR(191) NOT NULL UNIQUE,
    value TEXT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS production_entries (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL,
    model VARCHAR(255) NOT NULL,
    serial VARCHAR(255) NOT NULL UNIQUE,
    timestamp VARCHAR(255) NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_production_date_model (date, model),
    INDEX idx_production_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS idle_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL,
    fromTime VARCHAR(64) NULL,
    toTime VARCHAR(64) NULL,
    duration DOUBLE NOT NULL DEFAULT 0,
    department VARCHAR(255) NULL,
    reason TEXT NULL,
    slot VARCHAR(64) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_idle_date (date),
    INDEX idx_idle_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS reload_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL,
    slot VARCHAR(64) NULL,
    type VARCHAR(255) NULL,
    count INT NOT NULL DEFAULT 1,
    timestamp VARCHAR(255) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_reload_date (date),
    INDEX idx_reload_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS production_models (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    customer VARCHAR(255) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS serial_ranges (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL,
    model VARCHAR(255) NOT NULL,
    start INT NOT NULL,
    end INT NOT NULL,
    expected INT NOT NULL DEFAULT 0,
    scanned INT NOT NULL DEFAULT 0,
    missing INT NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_range_date_model (date, model),
    INDEX idx_range_created (createdAt)
  )`,
  `CREATE TABLE IF NOT EXISTS manpower (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    date VARCHAR(32) NOT NULL UNIQUE,
    manpower INT NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
];

export const ensureSchema = async () => {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = getPool();
      for (const statement of ddl) {
        await db.query(statement);
      }
    })().catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
};

export const connectDB = async () => {
  await ensureSchema();
  return getPool();
};

export default connectDB;
