CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  title TEXT,
  domain TEXT,
  chunk_count INT DEFAULT 0,
  uploaded_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id SERIAL PRIMARY KEY,
  document_id INT REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  section_ref TEXT,
  metadata JSONB DEFAULT '{}',
  token_count INT DEFAULT 0,
  embedding DOUBLE PRECISION[],
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_chunk
  ON chunks (document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id
  ON chunks (document_id);