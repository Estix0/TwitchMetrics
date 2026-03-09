#!/bin/bash
python chat_bot.py &
streamlit run panel.py --server.port 8501 --server.address 0.0.0.0
