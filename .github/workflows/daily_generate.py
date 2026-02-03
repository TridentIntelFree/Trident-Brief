import google.generativeai as genai
import os
import datetime

genai.configure(api_key=os.environ["GEMINI_API_KEY"])
model = genai.GenerativeModel("gemini-1.5-flash")

today = datetime.date.today().strftime("%B %d, %Y")

prompt = f"""
Create a concise daily intelligence brief titled "The Trident Brief" for {today}.
Focus on: Geopolitics, Technology & Cyber threats, UAP developments, Parapsychology research.
Use neutral, evidence-based tone. Keep total under 700 words.

Output ONLY this exact HTML fragment (nothing else, no explanations):
<p class="date">Daily Intelligence Assessment – {today}</p>

<div class="section">
    <h2>Geopolitics</h2>
    <p>[Your generated summary paragraph(s) here]</p>
    <ul><li>[bullet if needed]</li></ul>
</div>

<div class="section">
    <h2>Technology & Cyber</h2>
    <p>[Your generated summary paragraph(s) here]</p>
</div>

<div class="section">
    <h2>UAP Developments</h2>
    <p>[Your generated summary paragraph(s) here]</p>
</div>

<div class="section">
    <h2>Parapsychology Research</h2>
    <p>[Your generated summary paragraph(s) here]</p>
</div>
"""

response = model.generate_content(prompt)
content = response.text.strip()

with open("index.html", "r") as f:
    html = f.read()

start = "<!-- DAILY_CONTENT_START -->"
end = "<!-- DAILY_CONTENT_END -->"

if start not in html or end not in html:
    print("Markers missing in index.html - cannot update.")
    exit(1)

before, after = html.split(start, 1)
_, after = after.split(end, 1)

new_html = before + start + "\n" + content + "\n" + end + after

with open("index.html", "w") as f:
    f.write(new_html)

print("Updated index.html with new AI content.")
