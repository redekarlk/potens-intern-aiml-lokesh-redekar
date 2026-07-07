import streamlit as st
import requests
import json

# Configuration
API_BASE_URL = "http://localhost:3000"

st.set_page_config(
    page_title="RAG Document Q&A & Analysis",
    page_icon=None,
    layout="wide",
)

st.title("Enterprise RAG Document Q&A & Analysis")
st.markdown("---")

# Fetch document list helper
@st.cache_data(ttl=10)
def get_documents():
    try:
        response = requests.get(f"{API_BASE_URL}/documents")
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        st.error(f"Could not connect to backend server at {API_BASE_URL}. Ensure it is running.")
    return []

docs = get_documents()

# Create navigation selection
selected_tab = st.radio(
    "Navigation Selector",
    ["Ask Questions", "Contradiction Analyzer", "Document Library"],
    horizontal=True,
    label_visibility="collapsed"
)
st.markdown("---")

# Tab 1: Ask Questions
if selected_tab == "Ask Questions":
    st.subheader("Grounded Question Answering")
    st.markdown("Ask any technical question. The system will retrieve relevant context, enforce grounding constraints, and translate responses to your language automatically.")

    question = st.text_input("Enter your question:", placeholder="e.g. What are the consistency trade-offs in NoSQL databases?")
    
    if st.button("Query API", type="primary"):
        if not question.strip():
            st.warning("Please enter a question.")
        else:
            with st.spinner("Retrieving facts and generating answer..."):
                try:
                    res = requests.post(f"{API_BASE_URL}/ask", json={"question": question})
                    if res.status_code == 200:
                        data = res.json()
                        
                        # Confidence indicator
                        confidence = data.get("confidence", 0)
                        col1, col2 = st.columns([4, 1])
                        
                        with col1:
                            if not data.get("covered", True):
                                st.error("Out of Scope")
                            else:
                                st.success("Grounded Response")
                        
                        with col2:
                            st.metric("Confidence Score", f"{int(confidence * 100)}%")
                        
                        # Answer box
                        st.markdown("### Answer")
                        st.info(data.get("answer"))
                        
                        # Language details
                        st.caption(f"Detected language: **{data.get('language', 'en').upper()}**")
                        
                        # Citations
                        st.markdown("### Grounding Citations")
                        citations = data.get("citations", [])
                        
                        if not citations:
                            st.write("No document citations used.")
                        else:
                            for idx, cit in enumerate(citations):
                                with st.expander(f"[{idx+1}] Source: {cit.get('source_file')} | Section: {cit.get('section_ref')} (Similarity: {int((cit.get('similarity_score') or 0)*100)}%)"):
                                    st.markdown(f"**Supporting Snippet:**")
                                    st.markdown(f"*{cit.get('snippet')}*")
                    else:
                        try:
                            err_msg = res.json().get("error", "Unknown backend error")
                            st.error(f"Backend Error: {err_msg}")
                        except:
                            st.error(f"Error: Backend returned status code {res.status_code}")
                except Exception as e:
                    st.error(f"Request failed: {str(e)}")

# Tab 2: Contradiction Analyzer
elif selected_tab == "Contradiction Analyzer":
    st.subheader("Factual Contradiction Detector")
    st.markdown("Select two documents to scan for conflicting claims or inconsistent facts.")

    if not docs:
        st.info("No documents found in the database. Go to the Document Library to load them.")
    else:
        doc_options = {f"{d['title']} ({d['filename']})": d['id'] for d in docs}
        
        col1, col2 = st.columns(2)
        with col1:
            doc_a_name = st.selectbox("Select Document A:", list(doc_options.keys()), key="doc_a")
        with col2:
            doc_b_name = st.selectbox("Select Document B:", list(doc_options.keys()), key="doc_b")
            
        topic = st.text_input("Focus Topic (optional):", placeholder="e.g. ACID transactions, consistency guarantees")
        
        if st.button("Analyze Conflicts"):
            id_a = doc_options[doc_a_name]
            id_b = doc_options[doc_b_name]
            
            if id_a == id_b:
                st.warning("Please select two different documents to compare.")
            else:
                with st.spinner("Analyzing document contents for factual conflicts..."):
                    try:
                        res = requests.post(f"{API_BASE_URL}/contradict", json={
                            "doc_id_a": id_a,
                            "doc_id_b": id_b,
                            "topic": topic if topic.strip() else None
                        })
                        if res.status_code == 200:
                            data = res.json()
                            has_conflict = data.get("has_conflict", False)
                            
                            if has_conflict:
                                st.error("Factual Contradictions Detected")
                            else:
                                st.success("No Factual Contradictions Identified.")
                                
                            st.markdown("### Summary Analysis")
                            st.write(data.get("reasoning"))
                            
                            conflicts = data.get("conflicts", [])
                            if conflicts:
                                st.markdown("### Detailed Conflicts Breakdown")
                                for c in conflicts:
                                    st.markdown(f"#### Topic: {c.get('topic')}")
                                    cc1, cc2 = st.columns(2)
                                    with cc1:
                                        st.warning(f"**{c.get('excerpt_a', {}).get('source')}**")
                                        st.markdown(f"*{c.get('excerpt_a', {}).get('text')}*")
                                    with cc2:
                                        st.warning(f"**{c.get('excerpt_b', {}).get('source')}**")
                                        st.markdown(f"*{c.get('excerpt_b', {}).get('text')}*")
                                    st.info(f"**Factual Conflict Explanation:** {c.get('explanation')}")
                                    st.markdown("---")
                        else:
                            try:
                                err_msg = res.json().get("error", "Unknown backend error")
                                st.error(f"Backend Error: {err_msg}")
                            except:
                                st.error(f"Error: Backend returned status code {res.status_code}")
                    except Exception as e:
                        st.error(f"Request failed: {str(e)}")

# Tab 3: Document Library
elif selected_tab == "Document Library":
    st.subheader("Ingested Documents Library")
    
    col1, col2 = st.columns([4, 1])
    with col1:
        st.markdown("List of all documents currently ingested and indexed in the RAG system.")
    with col2:
        if st.button("Trigger Ingestion Scanner", type="secondary"):
            with st.spinner("Scanning data/source_docs and importing..."):
                try:
                    res = requests.post(f"{API_BASE_URL}/ingest")
                    if res.status_code == 200:
                        st.toast("Ingestion scan complete!")
                        st.rerun()
                    else:
                        st.error("Failed to trigger scan")
                except Exception as e:
                    st.error(f"Scanner connection failed: {str(e)}")

    if not docs:
        st.info("No documents are currently ingested in the system. Use the button above to ingest documents from 'data/source_docs/' directory.")
    else:
        # Display as a table
        table_data = []
        for d in docs:
            table_data.append({
                "ID": d.get("id"),
                "Filename": d.get("filename"),
                "Title": d.get("title"),
                "Domain": d.get("domain"),
                "Total Chunks": d.get("chunk_count"),
                "Ingestion Time": d.get("uploaded_at")
            })
        st.table(table_data)