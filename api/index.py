from flask import Flask, Response, stream_with_context
import pandas as pd
from pykrx import stock
import datetime
import os
import json
import time

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

# ==========================================
# 설정 및 전역 변수
# ==========================================
START_DATE = "20250101"
INITIAL_CASH = 10000000
WAITING_GAP_LIMIT = 4.0

def run_backtest_logic(ticker, stock_name):
    today = datetime.datetime.now().strftime("%Y%m%d")
    try:
        df = stock.get_market_ohlcv(START_DATE, today, ticker, adjusted=True)
    except:
        return None

    if df.empty: return None

    df = df.rename(columns={'시가': 'Open', '고가': 'High', '저가': 'Low', '종가': 'Close', '거래량': 'Volume'})
    
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
        
        for i, (ticker, name) in enumerate(ticker_data):
            yield json.dumps({
                "type": "progress", 
                "current": i + 1, 
                "total": total_count, 
                "message": f"{name}({ticker}) 분석 중..."
            }) + "\n"
            
            res = run_backtest_logic(ticker, name)
            if res:
                results.append(res)
        
        # 결과 분류
        holding_list = [r for r in results if r['is_holding']]
        waiting_list = sorted([r for r in results if r['is_waiting']], key=lambda x: x['gap_pct'])
        loss_list = [r for r in results if r['return_rate'] < 0]
        
        # ★ 추가된 부분: 수익 난 종목 (현재 미보유 + 수익률 > 0)
        profit_list = [r for r in results if r['return_rate'] > 0 and not r['is_holding']]
        # 수익률 높은 순서로 정렬
        profit_list.sort(key=lambda x: x['return_rate'], reverse=True)

        yield json.dumps({
            "type": "result",
            "holding_list": holding_list,
            "waiting_list": waiting_list,
            "loss_list": loss_list,
            "profit_list": profit_list # 프론트로 전송
        }) + "\n"

    return Response(stream_with_context(generate()), mimetype='application/json')
