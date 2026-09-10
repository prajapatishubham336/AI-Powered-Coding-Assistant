import os
import ast
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

load_dotenv()

# Flask Setup
app = Flask(__name__)

# CodeForge AI System Prompt
SYSTEM_PROMPT = """
You are CodeForge AI, an expert coding assistant, software engineer, debugger,
UI developer, and programming tutor.

Your job is to understand the user's intent even when the user gives only code,
only a short prompt, or a prompt together with existing code.

==================================================
CORE BEHAVIOR
==================================================

Always analyze the user's input before answering.

There are four main situations:

1. USER GIVES ONLY A NORMAL PROMPT
2. USER GIVES A PROMPT + EXISTING CODE
3. USER ASKS FOR UI / FRONTEND CODE
4. USER ONLY PASTES CODE WITHOUT ANY EXPLANATION

Handle each situation correctly.

==================================================
1. NORMAL PROMPT / PROJECT REQUEST
==================================================

If the user asks something like:

"make a fake news detection project"
"create calculator in python"
"make login page"
"create chatbot"
"make a machine learning project"

Then:

A. First give a short explanation of what the requested solution does.

B. Explain the important technologies/concepts used.

C. Then provide the complete runnable code.

D. Prefer ONE main Markdown code block whenever the solution can reasonably
   be written in one file.

E. Do not give unnecessary project structures, JSON, notebook metadata,
   or complicated architecture unless the user specifically asks for them.

F. Code should be practical, beginner-friendly and runnable.

Example response structure:

Explanation:
Short explanation of the solution.

Technologies:
- Python
- Flask
- HTML/CSS/JavaScript

Code:

```python
complete code here
"""


# Helper: Limit Large Text
def limit_text(text, limit=4500):
    """
    Prevent very large prompts and reduce token usage.
    """
    if not text:
        return ""
    text = str(text)
    if len(text) > limit:
        return text[:limit] + "\n...[content truncated]..."
    return text

# Get Groq Model
def get_llm():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is missing in .env")

    return ChatGroq(
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"),
        temperature=0,
        api_key=api_key
    )

# Python Code Validation
def python_validation(text):
    if not text:
        return None
    start = text.find("```python")
    if start == -1:
        start = text.find("```py")
    if start == -1:
        return None
    first_newline = text.find("\n", start)
    if first_newline == -1:
        return None
    end = text.find(
        "```",
        first_newline + 1)
    if end == -1:
        return None
    code = text[
        first_newline + 1:end]
    try:
        ast.parse(code)
        compile(code, "<codeforge>", "exec")
        return {
            "ok": True,
            "message": "Python syntax check passed."
        }
    except SyntaxError as e:
        return {
            "ok": False,
            "message": (f"Python syntax error on line "f"{e.lineno}: {e.msg}")}
    except Exception as e:
        return {
            "ok": False,
            "message": (f"Python validation failed: {e}")}

# Chat With AI
def chat_with_ai( message, files, history):
    llm = get_llm()
    messages = [SystemMessage(content=SYSTEM_PROMPT)]

    # Add limited previous conversation
    safe_history = history[-6:]
    for item in safe_history:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = limit_text(item.get("content", ""),3500)
        if not content:
            continue
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))

    # Current user prompt
    prompt = message.strip()
    if files:
        prompt += (
            "\n\nATTACHED CODE FILES:\n"
        )

        for file in files[:3]:
            name = file.get("name","unknown_file")
            content = limit_text(file.get("content", ""), 3500)
            prompt += (
                f"\n--- {name} ---\n"
                f"{content}\n"
            )

    messages.append(HumanMessage(content=prompt))
    response = llm.invoke(messages)
    return response.content

# Home Page
@app.route("/")
def index():
    return render_template(
        "index.html"
    )

# Chat API
@app.post("/api/chat")
def api_chat():
    try:
        data = ( request.get_json(silent=True) or {})
        message = data.get("message", "").strip()
        history = data.get("history", [])
        files = data.get("files", [])
        if not message:
            return jsonify({"error": "Please enter a prompt or paste code."}), 400
        print("\n" + "=" * 60)
        print("CODEFORGE AI")
        print("=" * 60)
        print("User:", message[:200])
        print("Files:",[f.get("name") for f in files])
        print("Calling Groq...")
        answer = chat_with_ai(message, files, history)
        print("Response received.")
        validation = python_validation(answer)
        return jsonify({
            "answer": answer,
            "validation": validation})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# File Upload API
@app.post("/api/upload")
def api_upload():
    try:
        uploaded_files = (request.files.getlist("files"))
        result = []
        for file in uploaded_files:
            if not file.filename:
                continue
            content = file.read().decode("utf-8", errors="replace")
            result.append({
                "name": file.filename,
                "content": content})

        return jsonify({"files": result})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Run Application
if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)