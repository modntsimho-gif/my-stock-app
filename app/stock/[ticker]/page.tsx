"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import TradingViewChart from "@/app/components/TradingViewChart";

export default function StockDetailPage({ params }: { params: { ticker: string } }) {
  const router = useRouter();
  const [stockData, setStockData] = useState<any>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [timeframe, setTimeframe] = useState<'d' | 'w' | 'm'>('d');
  // 👇 [추가] 클릭한 날짜를 저장할 상태
  const [focusDate, setFocusDate] = useState<string | null>(null);

  useEffect(() => {
    const savedData = sessionStorage.getItem('currentStockDetail');
    if (savedData) {
      const parsed = JSON.parse(savedData);
      setStockData(parsed);
      
      setLoading(true);
      fetch(`/api/chart?ticker=${parsed.ticker}&freq=${timeframe}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            const sorted = data.sort((a:any, b:any) => new Date(a.date).getTime() - new Date(b.date).getTime());
            setChartData(sorted);
          }
        })
        .catch(err => console.error("차트 로딩 실패", err))
        .finally(() => setLoading(false));
    } else {
      alert("종목 정보가 없습니다.");
      router.push('/');
    }
  }, [router, timeframe]);

  // 👇 [추가] 타임라인 클릭 핸들러
  const handleLogClick = (date: string) => {
    // 주봉/월봉 상태라면 일봉으로 변경 (정확한 날짜 마커를 보기 위함)
    if (timeframe !== 'd') {
      setTimeframe('d');
    }
    setFocusDate(date);
    // 차트가 있는 화면 상단으로 부드럽게 스크롤 이동
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!stockData) return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">로딩 중...</div>;

  let displayRate = 0;
  let rateLabel = "수익률";
  let priceLabel = "평균단가";
  let targetOrAvgPrice = stockData.avg_price;

  if (stockData.is_holding) {
    displayRate = ((stockData.current_price - stockData.avg_price) / stockData.avg_price) * 100;
    rateLabel = "현재 수익률";
  } else if (stockData.is_waiting) {
    displayRate = stockData.current_upside;
    rateLabel = "기대 수익률";
    priceLabel = "목표 매수가";
    targetOrAvgPrice = stockData.target_buy_price;
  } else {
    const lastTrade = stockData.trade_history && stockData.trade_history.length > 0 
                      ? stockData.trade_history[stockData.trade_history.length - 1] 
                      : null;
    displayRate = lastTrade && lastTrade.profit_rate ? lastTrade.profit_rate : 0;
    rateLabel = "최종 매도 수익률";
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans md:font-mono pb-10">
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-4 flex items-center gap-4 shadow-sm">
        <button 
          onClick={() => router.back()} 
          className="text-gray-400 hover:text-white bg-gray-800 px-4 py-2 rounded-lg transition-colors font-bold"
        >
          ← 뒤로가기
        </button>
        <h1 className="text-xl md:text-2xl font-bold text-white flex items-center gap-2">
          {stockData.stock_name} <span className="text-sm text-gray-500 font-normal bg-gray-800 px-2 py-1 rounded">{stockData.ticker}</span>
        </h1>
      </div>

      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
        {/* 1. 요약 정보 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-inner">
            <div className="text-xs text-gray-400 mb-1">현재가</div>
            <div className="font-bold text-2xl text-white">{stockData.current_price?.toLocaleString()}원</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-inner">
            <div className="text-xs text-gray-400 mb-1">{priceLabel}</div>
            <div className="font-bold text-2xl text-white">{targetOrAvgPrice ? parseInt(targetOrAvgPrice).toLocaleString() + '원' : '-'}</div>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-inner">
            <div className="text-xs text-gray-400 mb-1">{rateLabel}</div>
            <div className={`font-bold text-2xl ${displayRate > 0 ? 'text-red-400' : displayRate < 0 ? 'text-blue-400' : 'text-white'}`}>
              {displayRate > 0 ? '+' : ''}{displayRate ? displayRate.toFixed(2) : 0}%
            </div>
          </div>
          <div className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-inner">
            <div className="text-xs text-gray-400 mb-1">상태</div>
            <div className="font-bold text-xl text-white mt-1">
              {stockData.is_holding ? "💼 보유 중" : stockData.is_waiting ? "⏳ 대기 중" : "💸 매도 완료"}
            </div>
          </div>
        </div>

        {/* 2. 대형 차트 영역 */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 shadow-lg">
          <div className="flex justify-between items-end mb-4">
            <div>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Price Chart</h2>
              <span className="text-xs text-gray-500 font-normal">MA20 & Bollinger Bands</span>
            </div>
            <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-700">
              <button onClick={() => setTimeframe('d')} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${timeframe === 'd' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>일봉</button>
              <button onClick={() => setTimeframe('w')} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${timeframe === 'w' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>주봉</button>
              <button onClick={() => setTimeframe('m')} className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${timeframe === 'm' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>월봉</button>
            </div>
          </div>

          <div className="h-[500px] w-full relative bg-gray-900/50 rounded-lg overflow-hidden">
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">차트 데이터 로딩 중...</div>
            ) : (
              <TradingViewChart 
                data={chartData} 
                tradeHistory={timeframe === 'd' ? (stockData.trade_history || []) : []} 
                focusDate={focusDate} // 👈 포커스 날짜 전달
              />
            )}
          </div>
        </div>

        {/* 3. 상세 매매 로그 (클릭 기능 추가) */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 shadow-lg">
          <div className="flex justify-between items-end mb-6">
            <div>
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Transaction Flow</h2>
              <span className="text-xs text-gray-500 font-normal">내역을 클릭하면 차트가 해당 날짜로 이동합니다</span>
            </div>
            <div className="text-xs text-gray-400">
              총 <span className="text-white font-bold">{stockData.trade_history?.length || 0}</span>건의 기록
            </div>
          </div>

          {(!stockData.trade_history || stockData.trade_history.length === 0) ? (
            <div className="text-center text-gray-500 py-10 bg-gray-900/30 rounded-lg border border-gray-800 border-dashed">매매 기록이 없습니다.</div>
          ) : (
            <div className="relative border-l-2 border-gray-700 ml-3 space-y-6">
              {[...stockData.trade_history].reverse().map((log: any, idx: number) => {
                const isBuy = log.type.includes("매수");
                const isProfit = log.realized_profit > 0;
                
                return (
                  // 👇 [수정] 클릭 이벤트(onClick) 및 호버 시 강조 효과(group-hover) 추가
                  <div 
                    key={idx} 
                    className="relative pl-6 cursor-pointer group" 
                    onClick={() => handleLogClick(log.date)}
                  >
                    <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-4 border-gray-800 transition-transform group-hover:scale-125 ${isBuy ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                    
                    <div className="bg-gray-900/50 p-4 rounded-lg border border-gray-700/50 group-hover:bg-gray-800 group-hover:border-gray-500 transition-all shadow-sm group-hover:shadow-md">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-bold px-2 py-0.5 rounded ${isBuy ? 'bg-red-900/30 text-red-400' : 'bg-blue-900/30 text-blue-400'}`}>
                              {log.type}
                            </span>
                            <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">{log.date}</span>
                          </div>
                          <div className="text-sm text-gray-300 mt-1">{log.detail}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-gray-100">{parseInt(log.price).toLocaleString()}원</div>
                          <div className="text-xs text-gray-500">{log.qty}주 체결</div>
                        </div>
                      </div>
                      
                      {!isBuy && log.realized_profit !== undefined && log.realized_profit !== null && (
                        <div className="mt-3 pt-3 border-t border-gray-800 flex justify-between items-center text-sm">
                          <span className="text-gray-400">실현 손익</span>
                          <span className={`font-bold ${isProfit ? 'text-red-400' : 'text-blue-400'}`}>
                            {isProfit ? '+' : ''}{parseInt(log.realized_profit).toLocaleString()}원
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
