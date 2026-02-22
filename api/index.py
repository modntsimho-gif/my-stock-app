from flask import Flask, Response, stream_with_context
import pandas as pd
from pykrx import stock
from supabase import create_client
import datetime
import os
import json
import time

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

# ==========================================
# 환경 변수 (Vercel 설정 필수)
# ==========================================
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

INITIAL_CASH = 10000000
WAITING_GAP_LIMIT = 4.0

def update_and_get_data(ticker):
    """
    1. DB 확인
    2. 오늘 데이터는 무조건 다시 조회 (장중 변동 반영)
    3. DB 업데이트(Upsert) 및 병합 반환
    """
    df_db = pd.DataFrame()
    last_date_db = None
    
    # -------------------------------------------------------
    # 1. Supabase에서 기존 데이터 조회
    # -------------------------------------------------------
    if SUPABASE_URL and SUPABASE_KEY:
        try:
            supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
            response = supabase.table("stock_candles")\
                .select("*")\
                .eq("ticker", ticker)\
                .order("date", desc=False)\
                .execute()
            
            if response.data:
                df_db = pd.DataFrame(response.data)
                df_db = df_db.rename(columns={
                    'date': 'Date', 'open': 'Open', 'high': 'High', 
                    'low': 'Low', 'close': 'Close', 'volume': 'Volume'
                })
                df_db['Date'] = pd.to_datetime(df_db['Date'])
                df_db = df_db.set_index('Date')
                if not df_db.empty:
                    last_date_db = df_db.index[-1]
        except Exception as e:
            print(f"DB Read Error: {e}")

    # -------------------------------------------------------
    # 2. 조회 시작 날짜 계산 (핵심 로직 수정)
    # -------------------------------------------------------
    today = datetime.datetime.now()
    fetch_start_date = "20250101" # DB 없으면 기본 시작일

    if last_date_db:
        # DB 마지막 날짜가 오늘이면? -> 오늘 데이터를 다시 받아와야 함 (덮어쓰기 위해)
        if last_date_db.date() == today.date():
            fetch_start_date = today.strftime("%Y%m%d")
            # 메모리에 있는 DB 데이터에서도 오늘 건 삭제 (중복 방지)
            df_db = df_db[df_db.index.date != today.date()]
        
        # DB 마지막 날짜가 어제 이전이면? -> 그 다음날부터 조회
        elif last_date_db.date() < today.date():
            fetch_start_date = (last_date_db + datetime.timedelta(days=1)).strftime("%Y%m%d")
        
        # DB가 미래 날짜를 가지고 있을 리는 없지만 예외처리
        else:
            return df_db.sort_index()
    
    # -------------------------------------------------------
    # 3. API 호출 (오늘 데이터 포함)
    # -------------------------------------------------------
    df_new = pd.DataFrame()
    
    # 조회할 날짜가 오늘보다 미래가 아닐 때만 실행
    if datetime.datetime.strptime(fetch_start_date, "%Y%m%d").date() <= today.date():
        try:
            today_str = today.strftime("%Y%m%d")
            # pykrx로 기간 조회
            df_new = stock.get_market_ohlcv(fetch_start_date, today_str, ticker, adjusted=True)
            
            if not df_new.empty:
                df_new = df_new.reset_index()
                # 컬럼 매핑
                col_map = {'날짜': 'Date', '시가': 'Open', '고가': 'High', '저가': 'Low', '종가': 'Close', '거래량': 'Volume'}
                if '날짜' not in df_new.columns:
                     col_map = {c: c for c in df_new.columns}
                df_new = df_new.rename(columns=col_map)
                
                valid_cols = [c for c in ['Date', 'Open', 'High', 'Low', 'Close', 'Volume'] if c in df_new.columns]
                df_new = df_new[valid_cols]
                
                # -------------------------------------------------------
                # 4. Supabase에 저장 (Upsert: 있으면 수정, 없으면 추가)
                # -------------------------------------------------------
                if SUPABASE_URL and SUPABASE_KEY:
                    try:
                        data_to_insert = []
                        for _, row in df_new.iterrows():
                            date_val = row['Date']
                            if isinstance(date_val, pd.Timestamp):
                                date_val = date_val.strftime("%Y-%m-%d")
                                
                            data_to_insert.append({
                                "ticker": ticker,
                                "date": date_val,
                                "open": int(row['Open']),
                                "high": int(row['High']),
                                "low": int(row['Low']),
                                "close": int(row['Close']),
                                "volume": int(row['Volume'])
                            })
                        
                        if data_to_insert:
                            # upsert가 핵심! (PK인 ticker+date가 같으면 덮어씀)
                            supabase.table("stock_candles").upsert(data_to_insert).execute()
                    except Exception as e:
                        print(f"DB Write Error: {e}")

                # 인덱스 설정
                df_new['Date'] = pd.to_datetime(df_new['Date'])
                df_new = df_new.set_index('Date')

        except Exception as e:
            print(f"API Fetch Error: {e}")

    # -------------------------------------------------------
    # 5. 병합 및 반환
    # -------------------------------------------------------
    if not df_db.empty and not df_new.empty:
        df_combined = pd.concat([df_db, df_new])
        # 혹시 모를 중복 제거 (마지막 값 우선)
        df_combined = df_combined[~df_combined.index.duplicated(keep='last')]
        return df_combined.sort_index()
    elif not df_db.empty:
        return df_db.sort_index()
    elif not df_new.empty:
        return df_new.sort_index()
    
    return None

def run_backtest_logic(ticker, stock_name):
    df = update_and_get_data(ticker)

    if df is None or df.empty: return None

    # 지표 계산
    df['MA20'] = df['Close'].rolling(window=20).mean()
    df['Std'] = df['Close'].rolling(window=20).std()
    df['BB_Upper'] = df['MA20'] + (2 * df['Std'])
    df['BB_Lower'] = df['MA20'] - (2 * df['Std'])
    df = df.dropna()

    if df.empty: return None

    cash = INITIAL_CASH
    holdings = 0
    avg_price = 0
    last_buy_price = 0
    entry_amount = 0
    buy_count = 0
    first_buy_date = "-"
    
    # 시뮬레이션
    for date, row in df.iterrows():
        current_price = row['Close']
        ma20 = row['MA20']
        bb_upper = row['BB_Upper']
        bb_lower = row['BB_Lower']
        date_str = date.strftime("%Y-%m-%d")
        
        target_mid = (ma20 + bb_upper) / 2
        upside_potential = ((target_mid - current_price) / current_price) * 100 if current_price > 0 else 0

        # [매도]
        if holdings > 0:
            target_tp = avg_price * 1.03 
            sell_signal = False
            sell_price = 0
            
            if row['High'] >= target_tp:
                sell_signal = True
                sell_price = row['Open'] if row['Open'] > target_tp else target_tp
            elif row['High'] >= target_mid:
                sell_signal = True
                sell_price = row['Open'] if row['Open'] > target_mid else target_mid

            if sell_signal:
                revenue = holdings * sell_price
                cash += revenue
                holdings = 0
                avg_price = 0
                buy_count = 0
                first_buy_date = "-"
                continue

        # [물타기]
        if holdings > 0:
            if current_price <= last_buy_price * 0.95:
                water_price = current_price 
                if cash >= entry_amount:
                    buy_qty = int(entry_amount / water_price)
                    cost = buy_qty * water_price
                    
                    total_qty = holdings + buy_qty
                    total_cost = (holdings * avg_price) + cost
                    avg_price = total_cost / total_qty
                    
                    holdings = total_qty
                    cash -= cost
                    last_buy_price = water_price
                    buy_count += 1

        # [진입]
        if holdings == 0:
            is_bb_touch = current_price <= bb_lower
            is_enough_room = upside_potential >= 4.0
            
            if is_bb_touch and is_enough_room:
                invest_money = cash * 0.1
                buy_qty = int(invest_money / current_price)
                if buy_qty > 0:
                    cost = buy_qty * current_price
                    cash -= cost
                    holdings = buy_qty
                    avg_price = current_price
                    last_buy_price = current_price
                    entry_amount = cost
                    first_buy_date = date_str

    final_asset = cash + (holdings * df.iloc[-1]['Close'])
    return_rate = (final_asset - INITIAL_CASH) / INITIAL_CASH * 100
    
    # 현재 상태 체크
    is_waiting = False
    gap_pct = 0.0
    target_buy_price = 0
    current_upside = 0.0
    
    last_row = df.iloc[-1]
    last_close = last_row['Close']
    last_bb_lower = last_row['BB_Lower']
    last_ma20 = last_row['MA20']
    last_bb_upper = last_row['BB_Upper']
    
    last_target_mid = (last_ma20 + last_bb_upper) / 2
    if last_close > 0:
        current_upside = ((last_target_mid - last_close) / last_close) * 100
        gap_pct = (last_close - last_bb_lower) / last_close * 100
    
    if holdings == 0:
        if 0 < gap_pct <= WAITING_GAP_LIMIT:
            is_waiting = True
            target_buy_price = last_bb_lower

    return {
        'ticker': ticker,
        'stock_name': stock_name,
        'return_rate': return_rate,
        'final_asset': final_asset,
        'is_holding': holdings > 0,
        'current_price': last_close,
        'avg_price': avg_price,
        'buy_count': buy_count,
        'first_buy_date': first_buy_date,
        'is_waiting': is_waiting,
        'gap_pct': gap_pct,
        'target_buy_price': target_buy_price,
        'current_upside': current_upside
    }

@app.route('/api/analyze')
def analyze():
    def generate():
        base_dir = os.path.dirname(os.path.abspath(__file__))
        ticker_file = os.path.join(base_dir, '대상티커.xlsx')

        if not os.path.exists(ticker_file):
            yield json.dumps({"type": "error", "message": "대상티커.xlsx 파일 없음"}) + "\n"
            return

        try:
            ranl_df = pd.read_excel(ticker_file)
            ranl_df['티커'] = ranl_df['티커'].astype(str).str.strip().str.zfill(6)
            if '종목명' in ranl_df.columns:
                ticker_data = list(zip(ranl_df['티커'], ranl_df['종목명']))
            else:
                ticker_data = []
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
            return

        total_count = len(ticker_data)
        yield json.dumps({"type": "start", "total": total_count}) + "\n"

        results = []
        
        for i, (ticker, name) in enumerate(ticker_data):
            yield json.dumps({
                "type": "progress", 
                "current": i + 1, 
                "total": total_count, 
                "message": f"{name} 분석 중..."
            }) + "\n"
            
            res = run_backtest_logic(ticker, name)
            if res:
                results.append(res)
            
            # API 호출이 일어날 경우를 대비해 약간의 텀
            time.sleep(0.05)
        
        # 결과 분류
        holding_list = [r for r in results if r['is_holding']]
        waiting_list = sorted([r for r in results if r['is_waiting']], key=lambda x: x['gap_pct'])
        loss_list = [r for r in results if r['return_rate'] < 0]
        profit_list = [r for r in results if r['return_rate'] > 0 and not r['is_holding']]
        profit_list.sort(key=lambda x: x['return_rate'], reverse=True)

        yield json.dumps({
            "type": "result",
            "holding_list": holding_list,
            "waiting_list": waiting_list,
            "loss_list": loss_list,
            "profit_list": profit_list
        }) + "\n"

    return Response(stream_with_context(generate()), mimetype='application/json')
