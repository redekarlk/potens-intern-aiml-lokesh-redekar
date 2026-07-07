CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  uploaded_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id SERIAL PRIMARY KEY,
  document_id INT REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  section_ref TEXT,
  embedding DOUBLE PRECISION[],
  created_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_document_chunk_idx
  ON chunks (document_id, chunk_index);