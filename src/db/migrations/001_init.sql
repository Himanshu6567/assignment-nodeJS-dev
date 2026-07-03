CREATE TABLE IF NOT EXISTS wallets (
  user_id VARCHAR(120) PRIMARY KEY,
  balance DECIMAL(14, 2) NOT NULL DEFAULT 10000.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS processed_transactions (
  id VARCHAR(120) PRIMARY KEY,
  processed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(120) PRIMARY KEY,
  user_id VARCHAR(120) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  currency CHAR(3) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_transactions_amount_positive CHECK (amount > 0),
  CONSTRAINT fk_transactions_wallets
    FOREIGN KEY (user_id) REFERENCES wallets(user_id)
) ENGINE=InnoDB;

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_currency ON transactions(currency);
CREATE INDEX idx_transactions_occurred_at ON transactions(occurred_at);
