from flask import Flask, Response, stream_with_context
import pandas as pd
from pykrx import stock
import datetime
import os
import json
import time
import math
import concurrent.futures

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

# ==========================================
# 설정
# ==========================================
START_DATE = "20250101"
INITIAL_CASH = 10000000
WAITING_GAP_LIMIT = 4.0

def clean_nan(value):
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
    return value

def run_backtest_logic(args):
    ticker, stock_name = args
    today = datetime.datetime.now().strftime("%Y%m%d")
    
    try:
        df = stock.get_market_ohlcv(START_DATE, today, ticker, adjusted=True)
    except:
        return None

    if df.empty: return None

    df = df.reset_index()
    col_map = {'날짜': 'Date', '시가': 'Open', '고가': 'High', '저가': 'Low', '종가': 'Close', '거래량': 'Volume'}
    if '날짜' not in df.columns:
         col_map = {c: c for c in df.columns}
    df = df.rename(columns=col_map)
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.set_index('Date')
    
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
    
    # ★ 거래 내역 기록용 리스트
    trade_history = [] 

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
            sell_type = ""
            
            if row['High'] >= target_tp:
                sell_signal = True
                sell_price = row['Open'] if row['Open'] > target_tp else target_tp
                sell_type = "목표가 달성 (3%)"
            elif row['High'] >= target_mid:
                sell_signal = True
                sell_price = row['Open'] if row['Open'] > target_mid else target_mid
                sell_type = "BB 중간값 도달"

            if sell_signal:
                revenue = holdings * sell_price
                profit_rate = (sell_price - avg_price) / avg_price * 100
                
                # ★ 매도 기록
                trade_history.append({
                    "date": date_str,
                    "type": "매도",
                    "detail": sell_type,
                    "price": clean_nan(sell_price),
                    "qty": holdings,
                    "profit_rate": clean_nan(profit_rate),
                    "balance": clean_nan(cash + revenue)
                })

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
                    
                    # ★ 물타기 기록
                    trade_history.append({
                        "date": date_str,
                        "type": "매수 (물타기)",
                        "detail": f"{buy_count}차 추매",
                        "price": clean_nan(water_price),
                        "qty": buy_qty,
                        "profit_rate": 0,
                        "balance": clean_nan(cash)
                    })

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
                    
                    # ★ 진입 기록
                    trade_history.append({
                        "date": date_str,
                        "type": "매수 (진입)",
                        "detail": "BB 하단 터치",
                        "price": clean_nan(current_price),
                        "qty": buy_qty,
                        "profit_rate": 0,
                        "balance": clean_nan(cash)
                    })

    final_asset = cash + (holdings * df.iloc[-1]['Close'])
    return_rate = (final_asset - INITIAL_CASH) / INITIAL_CASH * 100
    
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
        gap_pct = (last_close - last_bb_lower) / last_close * 100

    if holdings == 0:
        if 0 < gap_pct <= WAITING_GAP_LIMIT:
            is_waiting = True
            target_buy_price = last_bb_lower
    
    if is_waiting and target_buy_price > 0:
        current_upside = ((last_target_mid - target_buy_price) / target_buy_price) * 100
    elif last_close > 0:
        current_upside = ((last_target_mid - last_close) / last_close) * 100

    return {
        'ticker': ticker,
        'stock_name': stock_name,
        'return_rate': clean_nan(return_rate),
        'final_asset': clean_nan(final_asset),
        'is_holding': holdings > 0,
        'current_price': clean_nan(last_close),
        'avg_price': clean_nan(avg_price),
        'buy_count': buy_count,
        'first_buy_date': first_buy_date,
        'is_waiting': is_waiting,
        'gap_pct': clean_nan(gap_pct),
        'target_buy_price': clean_nan(target_buy_price),
        'current_upside': clean_nan(current_upside),
        'trade_history': trade_history  # ★ 여기에 거래 내역 추가됨
    }

@app.route('/api/analyze')
def analyze():
    def generate():
        base_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(base_dir, '대상티커.xlsx')

        if not os.path.exists(file_path):
            yield json.dumps({"type": "error", "message": "엑셀 파일 없음"}) + "\n"
            return

        try:
            ranl_df = pd.read_excel(file_path)
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
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            future_to_ticker = {executor.submit(run_backtest_logic, t): t for t in ticker_data}
            completed_count = 0
            
            for future in concurrent.futures.as_completed(future_to_ticker):
                completed_count += 1
                ticker, name = future_to_ticker[future]
                
                try:
                    res = future.result()
                    if res:
                        results.append(res)
                    
                    yield json.dumps({
                        "type": "progress", 
                        "current": completed_count, 
                        "total": total_count, 
                        "message": f"{name} 완료!"
                    }) + "\n"
                    
                except Exception as e:
                    print(f"Error {name}: {e}")

        # 결과 분류
        holding_list = [r for r in results if r['is_holding']]
        
        waiting_list = sorted(
            [r for r in results if r['is_waiting']], 
            key=lambda x: x['gap_pct'] if x['gap_pct'] is not None else 999
        )
        
        loss_list = [r for r in results if r['return_rate'] is not None and r['return_rate'] < 0]
        
        profit_list = [r for r in results if r['return_rate'] is not None and r['return_rate'] > 0 and not r['is_holding']]
        profit_list.sort(key=lambda x: x['return_rate'], reverse=True)

        yield json.dumps({
            "type": "result",
            "holding_list": holding_list,
            "waiting_list": waiting_list,
            "loss_list": loss_list,
            "profit_list": profit_list
        }) + "\n"

    return Response(stream_with_context(generate()), mimetype='application/json')
