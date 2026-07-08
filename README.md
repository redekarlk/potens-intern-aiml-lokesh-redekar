# Enterprise RAG Backend Service

This is the backend server for the **Enterprise RAG Document Q&A & Analysis System**. It is built using **Node.js, Express, PostgreSQL, and the Google Gemini API** (via the `@google/genai` SDK). It handles document ingestion, chunking, vector embedding, hybrid semantic retrieval, LLM-based reranking, grounded Q&A generation with citations, multilingual boundaries, and factual contradiction detection.

---

## Setup & Installation Guide

### Prerequisites
Before setting up the project, make sure you have the following installed locally:
*   **Node.js** (v18 or higher)
*   **PostgreSQL** (with a running instance and database created)
*   **Git**

### 1. Clone the Repository
Clone the repository to your local machine:
```bash
git clone https://github.com/redekarlk/potens-intern-aiml-lokesh-redekar.git
cd backend
```

### 2. Install Dependencies
Install all required Node.js packages:
```bash
npm install
```

### 3. Environment Configuration (`.env`)
Create a `.env` file in the root of the `backend/` folder. Use the template below or duplicate `.env.example`:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_NAME=potens_assesment
DB_POOL_MAX=10

# AI Provider Selection ('gemini' or 'vertex')
AI_PROVIDER=gemini

# Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here

# RAG & Model Configuration
SIMILARITY_THRESHOLD=0.55
TOP_K=5
AI_TEXT_MODEL=gemini-2.5-flash
AI_EMBEDDING_MODEL=gemini-embedding-001
ENABLE_RERANKER=true
```

> [!IMPORTANT]
> Make sure to replace `your_postgres_password` and `your_gemini_api_key_here` with your actual local configurations.

### 4. Database Setup & Ingestion Seeding
Create your local database matching `DB_NAME` (e.g. `potens_assesment`), then execute:

```bash
# Run database migrations to create tables (documents, chunks)
npm run migrate

# Place PDF and TXT source documents inside backend/data/source_docs/
# Run the seed script to scan, chunk, embed, and load them into PostgreSQL
npm run seed
```

### 5. Running the Backend Server
Start the development server with hot-reloading (using nodemon):
```bash
npm run dev
```
The backend server will run on `http://localhost:3000`.

### 6. Running the Frontend (Streamlit Dashboard)
The frontend is a **Streamlit** web app located in the `frontend/` folder inside `backend/`. It provides a visual interface for asking questions, detecting contradictions, and browsing ingested documents.

Make sure the backend server is running first. Open a **new terminal** and follow one of these options:

#### Option A: Running from the project root directory
```bash
# Install Python dependencies
python -m pip install -r backend/frontend/requirements.txt

# Launch the Streamlit dashboard
python -m streamlit run backend/frontend/streamlit_app.py
```

#### Option B: Running from inside the `backend/` directory
```bash
# Install Python dependencies
python -m pip install -r frontend/requirements.txt

# Launch the Streamlit dashboard
python -m streamlit run ./frontend/streamlit_app.py
```

Open **`http://localhost:8501`** in your browser. The dashboard has three tabs:
*   **Ask Questions** — Submit queries, get cited answers with confidence scores.
*   **Contradiction Analyzer** — Select two documents and scan them for conflicting claims.
*   **Document Library** — View all ingested documents and trigger a re-scan.

---

## Core Document Processing Pipeline

The backend implements an automatic ingestion pipeline divided into three main stages:

### 1. Ingestion ([ingest.js](file:///d:/potens_assesment/backend/src/services/ingest.js))
* **Directory Scanning**: Scans the `data/source_docs/` folder for `.txt` and `.pdf` documents using file-system read operations.
* **Idempotency Checks**: Checks filenames and sizes against the `documents` table database records before indexing. If a file of the same name exists, it is skipped to prevent duplicate records and save API/computational resources.
* **Binary PDF Parsing**: Parses binary PDF streams using `pdf-parse` to extract page indexes and raw contents. It uses regex matches on pagination boundaries (e.g. `-- N of M --`) to record page character offset markers.
* **Transaction-Bound Storage**: Inserts the document meta-record and all related chunks inside a single SQL transaction. If chunking, embedding, or database operations fail at any point, the transaction automatically rolls back.

### 2. Chunking Strategy ([chunker.js](file:///d:/potens_assesment/backend/src/services/chunker.js))
To preserve context coherence and avoid truncating concepts mid-sentence, the system uses a **hierarchical, sentence-aware chunking algorithm**:
1. **Section Identification**: Breaks the cleaned text into logical sections based on structural headings. It scans for Markdown headings (`#`), underline indicators (`===`/`---`), numbered section indicators (`5.3 Measure`), and document-specific breakouts (`GOVERN 1`, `Table 1:`, `Figure 2:`).
2. **Sentence Boundaries**: Splits section text into clean sentence arrays using punctuation regex matching (`.`, `!`, `?`). A negative lookahead (`(?![\d])`) is implemented to ignore decimal indices so they are not treated as punctuation boundaries.
3. **Token-Aware Packing**: Sentences are grouped sequentially into chunks targeting **~500 tokens** (estimated via character-to-token ratio `length / 4`).
4. **Boundary Overlap**: Maintains a **15% overlap (~75 tokens)** between successive chunks in the same section to preserve context across boundaries.
5. **Metadata Binding**: Chunks are tagged with the parent section heading (or fallback page index `p. N` calculated from character offset page ranges), source filename, character index offsets, and token count.

### 3. Embed & Store ([embeddings.js](file:///d:/potens_assesment/backend/src/services/embeddings.js))
* **Vector Embeddings**: Calls `getAiClient().models.embedContent` using standard `gemini-embedding-001` configured with `outputDimensionality: 768` (when using Gemini API Key) or `text-embedding-004` (when using GCP Vertex AI).
* **Resilient API Queue**: Implements an **exponential backoff retry queue** that intercepts transient errors (`429 Rate Limit`, `503 Service Unavailable`, `500 Internal Error`). It batches requests (batch size = 30) with safety delays and doubles the retry delay on failure (starting at 5s, doubling up to 10 retries).
* **Decoupled Database Storage**: Inserts float vectors into the PostgreSQL `chunks` table as a standard `DOUBLE PRECISION[]` float array. This decouples the database schema from a fixed vector type/length, enabling future model migrations without database alters.

---

## REST API Routes & Documentation

### 1. Query Q&A: `POST /ask`
Submit queries to retrieve documents and synthesize answers with grounding citations.
*   **Endpoint**: `POST /ask`
*   **Request Body**:
    ```json
    {
      "question": "¿Cuáles son las cuatro funciones del marco AI RMF?",
      "doc_ids": [1, 2]
    }
    ```
    > `doc_ids` is optional. Omit it to search across all ingested documents.
*   **Response**:
    ```json
    {
      "answer": "Las cuatro funciones del marco AI RMF son GOVERN [1], MAP [2], MEASURE [2] y MANAGE [1].",
      "language": "es",
      "citations": [
        {
          "source_file": "nist_ai_100_1.pdf",
          "section_ref": "5.1 Govern",
          "snippet": "GOVERN: Cultivate a culture of risk management...",
          "similarity_score": 0.812
        },
        {
          "source_file": "nist_ai_100_1.pdf",
          "section_ref": "Introduction",
          "snippet": "The Core of the AI RMF consists of Map, Measure...",
          "similarity_score": 0.789
        }
      ],
      "confidence": 0.87,
      "covered": true
    }
    ```
*   **Grounding Logic & Output Details**:
    *   Queries in non-English are detected and translated to English at the boundary. The backend retrieves the English source chunks, generates the answer in English, and translates the response back to the query's native language.
    *   Retrieval employs **two-stage ranking**: 15 database candidates are fetched, reranked via Gemini, filtered for diversification (capping max 2 chunks per doc), and passed to the generator.
    *   Strict grounding constraints refuse to answer (setting `covered: false`) if the documents do not address the query.

---

### 2. Compare Conflicts: `POST /contradict`
Scan claims between two documents to find direct contradictions.
*   **Endpoint**: `POST /contradict`
*   **Request Body**:
    ```json
    {
      "doc_id_a": 3,
      "doc_id_b": 5,
      "topic": "consistency model guidelines"
    }
    ```
    > `topic` is optional. Omit it to compare all topics across both documents.
*   **Response**:
    ```json
    {
      "has_conflict": true,
      "reasoning": "Document A and Document B conflict on the scope of ACID transaction consistency requirements.",
      "conflicts": [
        {
          "topic": "ACID transactions",
          "excerpt_a": {
            "source": "nist_ai_100_1.pdf",
            "text": "Consistency rules dictate that..."
          },
          "excerpt_b": {
            "source": "oecd_recommendation.pdf",
            "text": "Consistency should be loose..."
          },
          "explanation": "Doc A requires strict operational consistency while Doc B recommends eventual consistency."
        }
      ]
    }
    ```

---

### 3. List Documents: `GET /documents`
Get a metadata listing of all currently ingested and indexed documents.
*   **Endpoint**: `GET /documents`
*   **Response**:
    ```json
    [
      {
        "id": 1,
        "filename": "nist_ai_100_1.pdf",
        "title": "NIST AI RMF 1.0",
        "domain": "AI Safety",
        "chunk_count": 142,
        "uploaded_at": "2026-07-07T12:00:00.000Z"
      }
    ]
    ```

---

### 4. Trigger Ingestion: `POST /ingest`
Manually trigger document ingestion scanner.
*   **Endpoint**: `POST /ingest`
*   **Response**:
    ```json
    {
      "success": true,
      "message": "Successfully scanned and imported new files."
    }
    ```

---

## AI Use Log (150k -200k tokens)

Leveraging AI allowed us to accelerate the development lifecycle and implement a highly resilient, enterprise-grade RAG pipeline:

* **Claude**: Assisted in implementing the sentence-aware hierarchical chunking logic and custom LLM reranker. The Streamlit user interface dashboard (`frontend/streamlit_app.py`) was fully created using Claude.
* **ChatGPT**:
  * Supported SQL schema migration designs, local vector distance calculations, and API documentation structures.
  * Aided in model version migration logic, handling rate limit recovery setups, and proxy configuration strategies.
