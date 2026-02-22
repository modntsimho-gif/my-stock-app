from flask import Flask, Response, stream_with_context
import pandas as pd
from pykrx import stock
import datetime
import os
import json
import time
import math

app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

INITIAL_CASH = 10000000
WAITING_GAP_LIMIT = 4.0

# ★ JSON 깨짐 방지: NaN(빈값)을 None(null)으로 변환
def clean_nan(value):
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
    return value

def run_backtest_logic(ticker, stock_name):
    # 1. 날짜 설정 (최근 6개월)
    today = datetime.datetime.now().strftime("%Y%m%d")
    start_date = (datetime.datetime.now() - datetime.timedelta(days=180)).strftime("%Y%m%d")

    try:
        # 2. 실시간 데이터 수집
        df = stock.get_market_ohlcv(start_date, today, ticker, adjusted=True)
        
        if df.empty: return None

        # 컬럼 정리
        df = df.reset_index()
        col_map = {'날짜': 'Date', '시가': 'Open', '고가': 'High', '저가': 'Low', '종가': 'Close', '거래량': 'Volume'}
        if '날짜' not in df.columns:
             col_map = {c: c for c in df.columns}
        df = df.rename(columns=col_map)
        df['Date'] = pd.to_datetime(df['Date'])
        df = df.set_index('Date')

        # 3. 지표 계산
        df['MA20'] = df['Close'].rolling(window=20).mean()
        df['Std'] = df['Close'].rolling(window=20).std()
        df['BB_Upper'] = df['MA20'] + (2 * df['Std'])
        df['BB_Lower'] = df['MA20'] - (2 * df['Std'])
        df = df.dropna()

        if df.empty: return None

        # 4. 백테스팅 로직
        cash = INITIAL_CASH
        holdings = 0
        avg_price = 0
        last_buy_price = 0
        entry_amount = 0
        buy_count = 0
        first_buy_date = "-"
        
        for date, row in df.iterrows():
            current_price = row['Close']
            ma20 = row['MA20']
            bb_upper = row['BB_Upper']
            bb_lower = row['BB_Lower']
            date_str = date.strftime("%Y-%m-%d")
            
            target_mid = (ma20 + bb_upper) / 2
            upside_potential = ((target_mid - current_price) / current_price) * 100 if current_price > 0 else 0

            # 매도
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

            # 물타기
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

            # 진입
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
        
        last_row = df.iloc[-1]
        last_close = last_row['Close']
        last_bb_lower = last_row['BB_Lower']
        last_ma20 = last_row['MA20']
        last_bb_upper = last_row['BB_Upper']
        
        last_target_mid = (last_ma20 + last_bb_upper) / 2
        current_upside = 0.0
        gap_pct = 0.0
        
        if last_close > 0:
            current_upside = ((last_target_mid - last_close) / last_close) * 100
            gap_pct = (last_close - last_bb_lower) / last_close * 100
        
        is_waiting = False
        target_buy_price = 0
        if holdings == 0:
            if 0 < gap_pct <= WAITING_GAP_LIMIT:
                is_waiting = True
                target_buy_price = last_bb_lower

        # 결과 반환 (NaN 청소 포함)
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
            'current_upside': clean_nan(current_upside)
        }
    except Exception as e:
        print(f"Error analyzing {ticker}: {e}")
        return None

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
            
            # 실시간 분석
            res = run_backtest_logic(ticker, name)
            if res:
                results.append(res)
            
            # ★ 중요: 실시간 크롤링은 너무 빠르면 차단되므로 딜레이 필요
            # 하지만 딜레이를 주면 Vercel 10초 제한에 걸림 (딜레마)
            time.sleep(0.2) 
        
        # 결과 분류
        holding_list = [r for r in results if r['is_holding']]
        waiting_list = sorted([r for r in results if r['is_waiting']], key=lambda x: x['gap_pct'] if x['gap_pct'] is not None else 999)
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
