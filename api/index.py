from flask import Flask, jsonify
import pandas as pd
from pykrx import stock
import datetime
import os

app = Flask(__name__)

# 한글 깨짐 방지
app.config['JSON_AS_ASCII'] = False

@app.route('/api/analyze')
def analyze():
    # 1. 엑셀 파일 경로 설정 (현재 파일 위치 기준)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(base_dir, '대상티커.xlsx')

    # 2. 파일 존재 여부 확인
    if not os.path.exists(file_path):
        return jsonify({"status": "error", "message": f"파일을 찾을 수 없습니다: {file_path}"})

    try:
        ranl_df = pd.read_excel(file_path)
        # 티커 포맷팅 (6자리)
        ranl_df['티커'] = ranl_df['티커'].astype(str).str.strip().str.zfill(6)
        
        if '종목명' in ranl_df.columns:
            ticker_data = list(zip(ranl_df['티커'], ranl_df['종목명']))
        else:
            ticker_data = []
            
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)})

    results = []
    waiting_list = []
    today = datetime.datetime.now().strftime("%Y%m%d")
    start_date = "20250101" # 시작일 고정

    # 3. 분석 로직
    # ★ 주의: Vercel 무료 버전은 10초 타임아웃이 있습니다.
    # 종목이 많으면 10초 안에 다 못 끝내서 에러(504)가 날 수 있습니다.
    # 테스트할 때는 엑셀 종목을 5개 정도로 줄여서 올리시는 것을 추천합니다.
    
    for ticker, name in ticker_data:
        try:
            df = stock.get_market_ohlcv(start_date, today, ticker, adjusted=True)
            if df.empty: continue
            
            df = df.rename(columns={'시가': 'Open', '고가': 'High', '저가': 'Low', '종가': 'Close'})
            
            # 볼린저밴드 계산
            df['MA20'] = df['Close'].rolling(window=20).mean()
            df['Std'] = df['Close'].rolling(window=20).std()
            df['BB_Upper'] = df['MA20'] + (2 * df['Std'])
            df['BB_Lower'] = df['MA20'] - (2 * df['Std'])
            
            last_row = df.iloc[-1]
            current_price = int(last_row['Close'])
            bb_lower = last_row['BB_Lower']
            ma20 = last_row['MA20']
            bb_upper = last_row['BB_Upper']
            
            target_mid = (ma20 + bb_upper) / 2
            upside = ((target_mid - current_price) / current_price) * 100 if current_price > 0 else 0
            
            gap_pct = 0.0
            if current_price > 0:
                gap_pct = (current_price - bb_lower) / current_price * 100
            
            # 조건: Gap이 4% 이내
            is_waiting = False
            if 0 < gap_pct <= 4.0:
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

    return jsonify({
        "status": "success",
        "total": len(results),
        "waiting_list": sorted(waiting_list, key=lambda x: x['gap_pct'])
    })
