# Evaluation Agent

## Purpose
Performs automated evaluation and hallucination detection on agent outputs — validating LLM generated SQL against source schemas.

## How to Attach Chatbot / Workflow
- **Template**: Edit `evaluation-agent.component.html` in the `.workspace-canvas` area to embed your chatbot component, message history, and input field.
- **Logic**: Add your state and service calls in `evaluation-agent.component.ts`.
