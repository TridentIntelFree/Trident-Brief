import os
import google.generativeai as genai

genai.configure(api_key=os.environ.get('GEMINI_API_KEY'))

print("Available models:")
for model in genai.list_models():
    if 'generateContent' in model.supported_generation_methods:
        print(f"- {model.name}")
