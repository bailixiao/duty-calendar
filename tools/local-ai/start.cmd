@echo off
rem 開本機 AI 門口（2026/11/27）：網站的「從照片或檔案新增」等 AI 判讀會先交給這台電腦的 Claude Code 讀；關掉這個視窗就改用 Gemini。
rem 可以在桌面建這個檔案的捷徑，開機後點兩下。
title 行事曆 AI 門口（關掉就改用 Gemini）
cd /d "%~dp0..\.."
node tools\local-ai\gateway.js
pause
