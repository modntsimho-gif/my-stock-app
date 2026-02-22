# upload_db.py (PC에서 실행용)
import pandas as pd
from pykrx import stock
from supabase import create_client
import time
import datetime
import os

# ==========================================
# 1. Supabase 설정 (본인 거 넣으세요!)
# ==========================================
SUPABASE_URL = "https://your-project-url.supabase.co"
SUPABASE_KEY = "your-anon-key"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ==========================================
# 2. 대상 종목 읽기
# ==========================================
try:
    df_tickers = pd.read_excel('대상티커.xlsx')
    df_tickers['티커'] = df_tickers['티커'].astype(str).str.strip().str.zfill(6)
    target_tickers = df_tickers['티커'].tolist()
    print(f"📂 대상 종목: {len(target_tickers)}개")
except:
    print("❌ 대상티커.xlsx 파일이 없습니다.")
    exit()

START_DATE = "20250101"
TODAY = datetime.datetime.now().strftime("%Y%m%d")

print("🚀 Supabase 업로드 시작...")

for i, ticker in enumerate(target_tickers):
    print(f"[{i+1}/{len(target_tickers)}] {ticker} 데이터 수집 및 업로드...", end="\r")
    
    try:
        # 1. 데이터 수집
        df = stock.get_market_ohlcv(START_DATE, TODAY, ticker, adjusted=True)
        if df.empty: continue
        
        df = df.reset_index()
        # 2. 컬럼명 영어로 변경 (DB 컬럼명과 일치시켜야 함)
        # pykrx 버전에 따라 컬럼명이 다를 수 있어 안전하게 처리
        df.columns = ['date', 'open', 'high', 'low', 'close', 'volume', 'val', 'change'][:len(df.columns)]
        
        # 3. 데이터 가공
        data_to_insert = []
        for _, row in df.iterrows():
            data_to_insert.append({
                "ticker": ticker,
                "date": row['date'].strftime("%Y-%m-%d"),
                "open": int(row['open']),
                "high": int(row['high']),
                "low": int(row['low']),
                "close": int(row['close']),
                "volume": int(row['volume'])
            })
            
        # 4. Supabase에 저장 (upsert: 중복되면 업데이트)
        if data_to_insert:
            supabase.table("stock_candles").upsert(data_to_insert).execute()
            
        time.sleep(0.3) # API 차단 방지

    except Exception as e:
        print(f"\n❌ {ticker} 에러: {e}")

print("\n✅ 모든 데이터 업로드 완료!")
