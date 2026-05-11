from flask import Flask, Response, stream_with_context, request, jsonify
import pandas as pd
import numpy as np
from pykrx import stock
import datetime
import os
import json
import math
import concurrent.futures

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

# ==========================================
# 설정
# ==========================================
START_DATE = "20210101"
INITIAL_CASH = 10000000
WAITING_GAP_LIMIT = 4.0

def clean_nan(value):
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
    return value

# ==========================================
# 1. 볼린저 밴드 전략 로직 (기존 코드 유지)
# ==========================================
def run_bb_logic(ticker, stock_name):
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
            
            if row['High'] >= target_mid:
                sell_signal = True
                sell_price = row['Open'] if row['Open'] > target_mid else target_mid
                sell_type = "BB 중간값 도달"
            elif row['High'] >= target_tp:
                sell_signal = True
                sell_price = row['Open'] if row['Open'] > target_tp else target_tp
                sell_type = "목표가 달성 (3%)"

            if sell_signal:
                revenue = holdings * sell_price
                profit_rate = (sell_price - avg_price) / avg_price * 100
                realized_profit = revenue - (holdings * avg_price)
                
                trade_history.append({
                    "date": date_str, "type": "매도", "detail": sell_type,
                    "price": clean_nan(sell_price), "qty": holdings,
                    "profit_rate": clean_nan(profit_rate), "realized_profit": clean_nan(realized_profit),
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
                    
                    trade_history.append({
                        "date": date_str, "type": "매수 (물타기)", "detail": f"{buy_count}차 추매",
                        "price": clean_nan(water_price), "qty": buy_qty,
                        "profit_rate": 0, "balance": clean_nan(cash)
                    })

        # [진입]
        if holdings == 0:
            if current_price <= bb_lower and upside_potential >= 4.0:
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
                    
                    trade_history.append({
                        "date": date_str, "type": "매수 (진입)", "detail": "BB 하단 터치",
                        "price": clean_nan(current_price), "qty": buy_qty,
                        "profit_rate": 0, "balance": clean_nan(cash)
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
    last_target_mid = (last_row['MA20'] + last_row['BB_Upper']) / 2
    
    if last_close > 0:
        gap_pct = (last_close - last_bb_lower) / last_close * 100

    if holdings == 0 and 0 < gap_pct <= WAITING_GAP_LIMIT:
        is_waiting = True
        target_buy_price = last_bb_lower
    
    if is_waiting and target_buy_price > 0:
        current_upside = ((last_target_mid - target_buy_price) / target_buy_price) * 100
    elif last_close > 0:
        current_upside = ((last_target_mid - last_close) / last_close) * 100

    if is_waiting and current_upside < 4.0:
        is_waiting = False

    return {
        'ticker': ticker, 'stock_name': stock_name, 'return_rate': clean_nan(return_rate),
        'final_asset': clean_nan(final_asset), 'is_holding': holdings > 0,
        'current_price': clean_nan(last_close), 'avg_price': clean_nan(avg_price),
        'buy_count': buy_count, 'first_buy_date': first_buy_date,
        'is_waiting': is_waiting, 'gap_pct': clean_nan(gap_pct),
        'target_buy_price': clean_nan(target_buy_price), 'current_upside': clean_nan(current_upside),
        'trade_history': trade_history
    }

# ==========================================
# 2. 매물대(Volume Profile) 전략 로직 (신규)
# ==========================================
def run_volume_logic(ticker, stock_name):
    today = datetime.datetime.now().strftime("%Y%m%d")
    try:
        df = stock.get_market_ohlcv(START_DATE, today, ticker, adjusted=True)
    except:
        return None

    if df.empty: return None

    df = df.reset_index()
    col_map = {'날짜': 'Date', '시가': 'Open', '고가': 'High', '저가': 'Low', '종가': 'Close', '거래량': 'Volume'}
    if '날짜' not in df.columns: col_map = {c: c for c in df.columns}
    df = df.rename(columns=col_map)
    df['Date'] = pd.to_datetime(df['Date'])
    df = df.set_index('Date')

    # 매물대 계산을 위한 대표 가격 (고가+저가+종가)/3
    df['Typical_Price'] = (df['High'] + df['Low'] + df['Close']) / 3
    
    cash = INITIAL_CASH
    holdings = 0
    avg_price = 0
    entry_amount = 0
    buy_count = 0
    first_buy_date = "-"
    trade_history = [] 

    window_size = 30 # 최근 90일(약 4개월) 간의 매물대 분석

    for i in range(len(df)):
        if i < window_size: continue
        
        row = df.iloc[i]
        current_price = row['Close']
        date_str = df.index[i].strftime("%Y-%m-%d")
        
        # 최근 90일 데이터 추출
        window_df = df.iloc[i-window_size:i+1]
        min_p, max_p = window_df['Typical_Price'].min(), window_df['Typical_Price'].max()
        
        if min_p == max_p: continue
        
        # numpy를 이용한 초고속 15구간 매물대 계산
        hist, bin_edges = np.histogram(window_df['Typical_Price'], bins=15, weights=window_df['Volume'])
        max_bin_idx = np.argmax(hist) # 가장 거래량이 많은 구간(가장 두꺼운 매물대)
        
        vp_bottom = bin_edges[max_bin_idx]
        vp_top = bin_edges[max_bin_idx + 1]

        # [매도] - 지지선(가장 두꺼운 매물대 하단) 이탈 시 손절/익절
        if holdings > 0:
            # 휩소 방지를 위해 매물대 하단에서 2% 이상 빠지면 매도 처리
            if current_price < vp_bottom * 0.98:
                revenue = holdings * current_price
                profit_rate = (current_price - avg_price) / avg_price * 100
                realized_profit = revenue - (holdings * avg_price)
                
                trade_history.append({
                    "date": date_str, "type": "매도", "detail": "매물대 지지 이탈",
                    "price": clean_nan(current_price), "qty": holdings,
                    "profit_rate": clean_nan(profit_rate), "realized_profit": clean_nan(realized_profit),
                    "balance": clean_nan(cash + revenue)
                })

                cash += revenue
                holdings = 0
                avg_price = 0
                buy_count = 0
                first_buy_date = "-"
                continue

        # [진입] - 가장 두꺼운 매물대 상단에 안착했을 때 (돌파 후 지지)
        if holdings == 0:
            # 주가가 매물대 상단 위 ~ 3% 이내에 있을 때 매수 (안전마진 확보)
            if vp_top <= current_price <= vp_top * 1.03:
                invest_money = cash * 0.1
                buy_qty = int(invest_money / current_price)
                if buy_qty > 0:
                    cost = buy_qty * current_price
                    cash -= cost
                    holdings = buy_qty
                    avg_price = current_price
                    entry_amount = cost
                    first_buy_date = date_str
                    
                    trade_history.append({
                        "date": date_str, "type": "매수 (진입)", "detail": "매물대 돌파 지지",
                        "price": clean_nan(current_price), "qty": buy_qty,
                        "profit_rate": 0, "balance": clean_nan(cash)
                    })

    final_asset = cash + (holdings * df.iloc[-1]['Close'])
    return_rate = (final_asset - INITIAL_CASH) / INITIAL_CASH * 100
    
    # 마지막 날 기준 대기 종목 판별
    is_waiting = False
    last_close = df.iloc[-1]['Close']
    
    # 마지막 90일 매물대
    window_df = df.iloc[-window_size:]
    hist, bin_edges = np.histogram(window_df['Typical_Price'], bins=15, weights=window_df['Volume'])
    max_bin_idx = np.argmax(hist)
    last_vp_bottom = bin_edges[max_bin_idx]
    last_vp_top = bin_edges[max_bin_idx + 1]

    # 대기 조건: 매물대 돌파 직전이거나, 돌파 후 눌림목 타점에 근접했을 때
    if holdings == 0:
        if last_vp_top * 0.98 <= last_close <= last_vp_top * 1.05:
            is_waiting = True

    return {
        'ticker': ticker, 'stock_name': stock_name, 'return_rate': clean_nan(return_rate),
        'final_asset': clean_nan(final_asset), 'is_holding': holdings > 0,
        'current_price': clean_nan(last_close), 'avg_price': clean_nan(avg_price),
        'buy_count': buy_count, 'first_buy_date': first_buy_date,
        'is_waiting': is_waiting, 'gap_pct': 0.0, # 매물대 전략에서는 사용 안함
        'target_buy_price': clean_nan(last_vp_top), 'current_upside': 0.0,
        'trade_history': trade_history
    }

# ==========================================
# 3. 전략 라우터 (Wrapper)
# ==========================================
def run_backtest_wrapper(args):
    ticker, stock_name, strategy = args
    if strategy == 'volume':
        return run_volume_logic(ticker, stock_name)
    else:
        return run_bb_logic(ticker, stock_name)

# ==========================================
# API 엔드포인트
# ==========================================
@app.route('/api/analyze')
def analyze():
    # 프론트엔드에서 넘겨준 전략 파라미터 받기 (기본값: bb)
    strategy = request.args.get('strategy', 'bb')
    target_filename = '대상티커.xlsx'

    def generate():
        base_dir = os.path.dirname(os.path.abspath(__file__))
        file_path = os.path.join(base_dir, target_filename)

        if not os.path.exists(file_path):
            yield json.dumps({"type": "error", "message": f"{target_filename} 파일이 없습니다."}) + "\n"
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
            # wrapper 함수에 strategy 파라미터 추가 전달
            future_to_ticker = {executor.submit(run_backtest_wrapper, (t[0], t[1], strategy)): t for t in ticker_data}
            completed_count = 0
            
            for future in concurrent.futures.as_completed(future_to_ticker):
                completed_count += 1
                ticker, name = future_to_ticker[future][:2]
                
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

        holding_list = [r for r in results if r['is_holding']]
        waiting_list = [r for r in results if r['is_waiting']]
        loss_list = [r for r in results if r['return_rate'] is not None and r['return_rate'] < 0 and not r['is_holding']]
        profit_list = [r for r in results if r['return_rate'] is not None and r['return_rate'] > 0 and not r['is_holding']]
        profit_list.sort(key=lambda x: x['return_rate'], reverse=True)

        total_net_profit = sum(r['final_asset'] - INITIAL_CASH for r in results if r['final_asset'] is not None)
        total_seed = INITIAL_CASH + total_net_profit
        total_return_rate = (total_net_profit / INITIAL_CASH) * 100 if INITIAL_CASH > 0 else 0

        yield json.dumps({
            "type": "result",
            "summary": {
                "initial_seed": INITIAL_CASH,
                "total_net_profit": total_net_profit,
                "total_seed": total_seed,
                "total_return_rate": total_return_rate
            },
            "holding_list": holding_list,
            "waiting_list": waiting_list,
            "loss_list": loss_list,
            "profit_list": profit_list
        }) + "\n"

    return Response(stream_with_context(generate()), mimetype='application/json')

@app.route('/api/chart')
def get_chart_data():
    ticker = request.args.get('ticker')
    freq = request.args.get('freq', 'd') 
    
    if not ticker:
        return jsonify({"error": "No ticker provided"}), 400

    today = datetime.datetime.now().strftime("%Y%m%d")
    start_date = (datetime.datetime.now() - datetime.timedelta(days=365 * 5)).strftime("%Y%m%d")

    try:
        df = stock.get_market_ohlcv(start_date, today, ticker, freq=freq, adjusted=True)
        
        if df.empty:
            return jsonify({"error": "Empty data"}), 404

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

        chart_data = []
        # 👇 [버그 수정] 기존 코드의 이중 for문(중첩 반복) 버그를 제거했습니다.
        for date, row in df.iterrows():
            chart_data.append({
                "date": date.strftime("%Y-%m-%d"),
                "open": int(row['Open']),
                "high": int(row['High']),
                "low": int(row['Low']),
                "close": int(row['Close']),
                "ma20": int(row['MA20']) if not math.isnan(row['MA20']) else None,
                "bb_upper": int(row['BB_Upper']) if not math.isnan(row['BB_Upper']) else None,
                "bb_lower": int(row['BB_Lower']) if not math.isnan(row['BB_Lower']) else None,
            })

        return jsonify(chart_data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500
