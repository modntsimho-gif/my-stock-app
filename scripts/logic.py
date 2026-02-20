import sys
import json
import pandas as pd
from pykrx import stock
import datetime
import os

# 한글 깨짐 방지
sys.stdout.reconfigure(encoding='utf-8')

# ==========================================
# 1. 설정 (경로 수정됨)
# ==========================================
# Node.js가 실행되는 루트 경로 기준에서 파일을 찾습니다.
BASE_DIR = os.getcwd() 
FILE_PATH = os.path.join(BASE_DIR, '대상티커.xlsx')

START_DATE = "20250101"
WAITING_GAP_LIMIT = 4.0

def run_analysis():
    # 파일 존재 여부 확인
    if not os.path.exists(FILE_PATH):
        # 에러를 JSON으로 리턴해야 프론트에서 알 수 있음
        print(json.dumps({
            "status": "error",
            "message": f"엑셀 파일을 찾을 수 없습니다. 경로: {FILE_PATH}"
        }, ensure_ascii=False))
        return

    try:
        ranl_df = pd.read_excel(FILE_PATH)
        # 티커 6자리 문자열로 변환 (005930 등)
        ranl_df['티커'] = ranl_df['티커'].astype(str).str.strip().str.zfill(6)
        
        if '종목명' in ranl_df.columns:
            ticker_data = list(zip(ranl_df['티커'], ranl_df['종목명']))
        else:
            ticker_data = []
            
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}, ensure_ascii=False))
        return

    results = []
    waiting_list = []
    today = datetime.datetime.now().strftime("%Y%m%d")

    # ==========================================
    # 2. 분석 로직
    # ==========================================
    for ticker, name in ticker_data:
        try:
            # pykrx로 데이터 조회
            df = stock.get_market_ohlcv(START_DATE, today, ticker, adjusted=True)
            if df.empty: continue
            
            # 컬럼명 영어로 변경
            df = df.rename(columns={'시가': 'Open', '고가': 'High', '저가': 'Low', '종가': 'Close'})
            
            # 볼린저밴드 계산
            df['MA20'] = df['Close'].rolling(window=20).mean()
            df['Std'] = df['Close'].rolling(window=20).std()
            df['BB_Upper'] = df['MA20'] + (2 * df['Std'])
            df['BB_Lower'] = df['MA20'] - (2 * df['Std'])
            
            # 마지막 날짜 데이터
            last_row = df.iloc[-1]
            current_price = int(last_row['Close'])
            bb_lower = last_row['BB_Lower']
            ma20 = last_row['MA20']
            bb_upper = last_row['BB_Upper']
            
            # 기대수익률 (BB상단과 MA20의 중간값 기준)
            target_mid = (ma20 + bb_upper) / 2
            upside = ((target_mid - current_price) / current_price) * 100 if current_price > 0 else 0
            
            # BB 하단과의 거리 (Gap)
            gap_pct = 0.0
            if current_price > 0:
                gap_pct = (current_price - bb_lower) / current_price * 100
            
            # 조건: Gap이 설정값 이내 (밴드 하단 근처)
            is_waiting = False
            if 0 < gap_pct <= WAITING_GAP_LIMIT:
                is_waiting = True

            item_data = {
                'ticker': ticker,
                'stock_name': name,
                'current_price': current_price,
                'gap_pct': round(gap_pct, 2),
                'upside': round(upside, 2),
                'target_price': int(bb_lower),
                'is_waiting': is_waiting
            }
            
            if is_waiting:
                waiting_list.append(item_data)
            
            results.append(item_data)

        except Exception:
            continue

    # ==========================================
    # 3. 결과 출력 (JSON)
    # ==========================================
    final_data = {
        "status": "success",
        "total": len(results),
        "waiting_list": sorted(waiting_list, key=lambda x: x['gap_pct'])
    }
    
    # 최종 결과만 JSON으로 출력
    print(json.dumps(final_data, ensure_ascii=False))

if __name__ == "__main__":
    run_analysis()
