-- RECAI local development schema (MySQL 8+)
-- Database: RECAI @ localhost:3306

CREATE DATABASE IF NOT EXISTS RECAI
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE RECAI;

-- ---------------------------------------------------------------------------
-- Sync audit log (INSERT only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_sync_log (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  endpoint      VARCHAR(255)  NOT NULL,
  method        VARCHAR(10)   NOT NULL,
  status        ENUM('success', 'error', 'skipped') NOT NULL,
  records_affected INT        NOT NULL DEFAULT 0,
  error_message TEXT          NULL,
  duration_ms   INT           NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_api_sync_log_endpoint (endpoint),
  INDEX idx_api_sync_log_synced_at (synced_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Runtime configuration (UPSERT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS runtime_config (
  config_key    VARCHAR(128) PRIMARY KEY,
  config_value  JSON          NOT NULL,
  updated_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Core entities (UPSERT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  store_id      VARCHAR(64)   PRIMARY KEY,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clusters (
  cluster_id    INT           PRIMARY KEY,
  store_count   INT           NOT NULL DEFAULT 0,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cluster_stores (
  cluster_id    INT           NOT NULL,
  store_id      VARCHAR(64)   NOT NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster_id, store_id),
  INDEX idx_cluster_stores_store (store_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cluster_top_skus (
  cluster_id    INT           NOT NULL,
  rank_position INT           NOT NULL,
  sku_code      VARCHAR(64)   NOT NULL,
  product_name  VARCHAR(512)  NULL,
  recommendation_count INT    NOT NULL DEFAULT 0,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cluster_id, rank_position),
  INDEX idx_cluster_top_skus_sku (sku_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS skus (
  sku_code      VARCHAR(64)   PRIMARY KEY,
  product_name  VARCHAR(512)  NULL,
  l2_category   VARCHAR(256)  NULL,
  category      VARCHAR(256)  NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recommendations (
  store_id      VARCHAR(64)   NOT NULL,
  sku_code      VARCHAR(64)   NOT NULL,
  cluster_id    INT           NULL,
  product_name  VARCHAR(512)  NULL,
  category      VARCHAR(256)  NULL,
  l2_category   VARCHAR(256)  NULL,
  source        VARCHAR(32)   NULL,
  confidence    DECIMAL(12, 6) NULL,
  explainability TEXT         NULL,
  forecasted_amt DECIMAL(16, 4) NULL,
  seasonality_multiplier DECIMAL(12, 6) NULL,
  forecasted_amt_after_seasonality DECIMAL(16, 4) NULL,
  promotional_multiplier DECIMAL(12, 6) NULL,
  final_adjusted_amt DECIMAL(16, 4) NULL,
  max_list_price DECIMAL(16, 4) NULL,
  volume        INT           NULL,
  rank_position INT           NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, sku_code),
  INDEX idx_recommendations_store (store_id),
  INDEX idx_recommendations_sku (sku_code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS store_recommendation_summary (
  store_id      VARCHAR(64)   PRIMARY KEY,
  cluster_id    INT           NULL,
  total_recommendations INT     NULL,
  top_confidence DECIMAL(12, 6) NULL,
  total_estimated_amount DECIMAL(16, 4) NULL,
  total_volume  INT           NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Analytics snapshots (UPSERT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dashboard_summary (
  snapshot_key  VARCHAR(64)   PRIMARY KEY,
  payload       JSON          NOT NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  snapshot_key  VARCHAR(255)  PRIMARY KEY,
  endpoint      VARCHAR(255)  NOT NULL,
  payload       JSON          NOT NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_analytics_snapshots_endpoint (endpoint)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS store_spend_history (
  store_id      VARCHAR(64)   NOT NULL,
  period        VARCHAR(16)   NOT NULL,
  spend         DECIMAL(16, 4) NOT NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, period),
  INDEX idx_store_spend_history_store (store_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Seasonality (UPSERT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seasonality_category (
  category      VARCHAR(256)  PRIMARY KEY,
  multipliers   JSON          NOT NULL,
  best_month    INT           NULL,
  worst_month   INT           NULL,
  data_years_available INT     NULL,
  history_span_years DECIMAL(8, 2) NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS seasonality_l2_list (
  snapshot_key  VARCHAR(64)   PRIMARY KEY,
  categories    JSON          NOT NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- AI outputs (UPSERT except chat / simulation history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_insights (
  insight_key   VARCHAR(255)  PRIMARY KEY,
  insight_type  VARCHAR(64)   NOT NULL,
  entity_id     VARCHAR(64)   NULL,
  payload       JSON          NOT NULL,
  insight       JSON          NOT NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_ai_insights_type (insight_type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_explanations (
  store_id      VARCHAR(64)   NOT NULL,
  sku_code      VARCHAR(64)   NOT NULL,
  explanation   TEXT          NOT NULL,
  recommendation JSON         NULL,
  synced_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, sku_code)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Append-only history (INSERT only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_history (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  messages      JSON          NOT NULL,
  reply         TEXT          NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_chat_history_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS simulation_history (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  store_id      VARCHAR(64)   NOT NULL,
  sku_code      VARCHAR(64)   NOT NULL,
  month         INT           NOT NULL,
  discount_pct  DECIMAL(8, 4) NOT NULL,
  result        JSON          NOT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_simulation_history_store_sku (store_id, sku_code),
  INDEX idx_simulation_history_created (created_at)
) ENGINE=InnoDB;
