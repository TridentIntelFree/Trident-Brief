import os
import json
from datetime import datetime
from google import genai

# New SDK - gets key from environment
client = genai.Client(api_key=os.environ.get('GEMINI_API_KEY'))

PROMPT = """You are generating THE TRIDENT BRIEF - a rigorously fact-checked intelligence digest for {date}.

CRITICAL REQUIREMENTS FOR FACTUAL ACCURACY:

1. SEARCH THE WEB extensively before making ANY claim
2. EVERY factual claim must cite a specific source with date
3. CROSS-REFERENCE major claims across multiple sources when possible
4. CLEARLY DISTINGUISH between:
   - VERIFIED: Confirmed by 2+ reputable sources
   - REPORTED: Single credible source
   - UNVERIFIED: Claim circulating but not confirmed
5. Include SKEPTICAL perspectives, especially for fringe topics
6. When sources conflict, NOTE THE CONFLICT explicitly

SOURCING STANDARDS:
- Tier 1 sources: Reuters, AP, Bloomberg, WSJ, FT, NYT, WaPo, BBC, official govt statements
- Tier 2 sources: Reputable regional outlets, established defense publications
- Always prefer original sources over aggregators
- For UAP/Psi topics: Only cite institutional sources, peer-reviewed research, or official statements

CREATE THESE SECTIONS:

## I. GEOPOLITICAL FLASHPOINTS
Search for and report on current international conflicts, diplomatic developments, and security issues.
For EACH major point:
- State the development
- Cite source(s) with publication and date
- Note if verified across multiple sources or single-source reporting

## II. TECHNOLOGY & POWER CONSOLIDATION
Search for and report on major tech industry moves, AI developments, regulatory actions, infrastructure projects.
For EACH major point:
- State the development
- Cite specific source with date
- Note verification status

## III. UAP/UFO DEVELOPMENTS
Search ONLY for:
- Official government statements or hearings
- Peer-reviewed research from credible institutions  
- Credible investigative journalism from Tier 1/2 sources

REQUIRED for each item:
- The claim
- The source (must be institutional/official)
- Skeptical counterpoint or mainstream scientific view
- Verification status

DO NOT include: Social media rumors, unverified sightings, speculative claims

## IV. PSI/PARAPSYCHOLOGY RESEARCH
Search ONLY for:
- Peer-reviewed studies in recognized journals
- Research from accredited universities/institutions
- Meta-analyses and systematic reviews

REQUIRED for each item:
- Research finding
- Institution/journal, date
- Mainstream scientific consensus on the topic
- Study limitations/criticisms

DO NOT include: Anecdotal claims, non-peer-reviewed sources

## ASSESSMENT
Synthesize the most significant VERIFIED developments.
Note any major stories where verification is pending or sources conflict.

FORMATTING:
- Every claim: [CLAIM] (Source: Publication, Date MM/DD/YYYY) [VERIFIED/REPORTED/UNVERIFIED]
- When sources conflict: "NOTE: [Source A] reports X while [Source B] reports Y"
- Total length: 1800-2200 words
- Measured, professional intelligence analyst tone
- NO speculation, fiction​​​​​​​​​​​​​​​​
