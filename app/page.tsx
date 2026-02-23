"use client";
import { useState } from "react";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedStock, setSelectedStock] = useState<any>(null); // ★ 모달용 상태

  const runAnalysis = async () => {
    setLoading(true);
    setResult(null);
    setLogs([]);
    setProgress({ current: 0, total: 0 });

    try {
      const response = await fetch("/api/analyze");
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim() !== "");

        for (const line of lines) {
          try {
            const data = JSON.parse(line);

            if (data.type === "start") {
              setProgress({ current: 0, total: data.total });
              setLogs((prev) => [...prev, `🚀 분석 시작... 총 ${data.total}개 종목`]);
            } else if (data.type === "progress") {
              setProgress({ current: data.current, total: data.total });
            } else if (data.type === "result") {
              setResult(data);
              setLogs((prev) => [...prev, "🏁 분석 완료!"]);
            } else if (data.type === "error") {
              setLogs((prev) => [...prev, `❌ 에러: ${data.message}`]);
            }
          } catch (e) {
            console.error("JSON 파싱 에러", e);
          }
        }
      }
    } catch (err) {
      alert("통신 중 에러 발생");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 font-sans md:font-mono text-sm pb-10 relative">
      {/* 헤더 영역 */}
      <div className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-800 p-4 shadow-lg">
        <h1 className="text-xl md:text-2xl font-bold text-green-400 mb-3 flex items-center gap-2">
          <span>📈</span> 가자 [반포자이]로 <span className="text-xs text-gray-500 font-normal mt-1">원베일리도 낫베드</span>
        </h1>

        {/* 컨트롤 패널 */}
        <div>
          <button
            onClick={runAnalysis}
            disabled={loading}
            className={`w-full md:w-auto px-6 py-3 rounded-lg font-bold transition-all shadow-md ${
              loading 
                ? "bg-gray-700 text-gray-400 cursor-not-allowed" 
                : "bg-green-600 hover:bg-green-500 text-white active:scale-95"
            }`}
          >
            {loading ? `분석 중... (${progress.current}/${progress.total})` : "🚀 분석 시작"}
          </button>
          
          {loading && progress.total > 0 && (
            <div className="w-full bg-gray-800 h-2 rounded-full mt-3 overflow-hidden">
              <div
                className="bg-green-500 h-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              ></div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-8">
        {result && (
          <>
            {/* ============================================================
                1. 보유 종목 (Holdings)
               ============================================================ */}
            <section>
              <h2 className="text-lg md:text-xl font-bold text-red-400 mb-3 flex items-center justify-between">
                <span>🔥 보유 중인 종목</span>
                <span className="bg-red-900/50 text-red-300 text-xs px-2 py-1 rounded-full">{result.holding_list.length}개</span>
              </h2>
              
              {result.holding_list.length === 0 ? (
                <div className="p-8 text-center bg-gray-800 rounded-lg text-gray-500 border border-gray-700">보유 종목이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {result.holding_list.map((item: any) => {
                     const rate = ((item.current_price - item.avg_price) / item.avg_price) * 100;
                     return (
                      <div 
                        key={item.ticker} 
                        onClick={() => setSelectedStock(item)} // ★ 클릭 시 모달 열기
                        className="bg-gray-800 p-4 rounded-xl border border-gray-700 shadow-sm relative overflow-hidden cursor-pointer hover:bg-gray-750 hover:border-gray-500 transition-all"
                      >
                        <div className={`absolute top-0 left-0 w-1 h-full ${rate > 0 ? 'bg-red-500' : 'bg-blue-500'}`}></div>
                        <div className="flex justify-between items-start mb-2 pl-2">
                          <div>
                            <div className="font-bold text-base text-gray-100">{item.stock_name}</div>
                            <div className="text-xs text-gray-500">{item.ticker}</div>
                          </div>
                          <div className={`text-lg font-bold ${rate > 0 ? "text-red-400" : "text-blue-400"}`}>
                            {rate > 0 ? "+" : ""}{rate.toFixed(2)}%
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 pl-2 bg-gray-900/30 p-2 rounded">
                          <div>평단: <span className="text-gray-200">{parseInt(item.avg_price).toLocaleString()}</span></div>
                          <div>현재: <span className="text-gray-200">{item.current_price.toLocaleString()}</span></div>
                          <div>매수: {item.first_buy_date}</div>
                          <div>물타기: {item.buy_count}회</div>
                        </div>
                      </div>
                     )
                  })}
                </div>
              )}
            </section>

            {/* ============================================================
                2. 매수 대기 (Waiting)
               ============================================================ */}
            <section>
              <h2 className="text-lg md:text-xl font-bold text-yellow-400 mb-3 flex items-center justify-between">
                <span>⏳ 매수 대기 (BB하단 접근)</span>
                <span className="bg-yellow-900/50 text-yellow-300 text-xs px-2 py-1 rounded-full">{result.waiting_list.length}개</span>
              </h2>

              {result.waiting_list.length === 0 ? (
                <div className="p-8 text-center bg-gray-800 rounded-lg text-gray-500 border border-gray-700">대기 중인 종목이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {result.waiting_list.map((item: any) => (
                    <div 
                      key={item.ticker} 
                      onClick={() => setSelectedStock(item)}
                      className="bg-gray-800 p-4 rounded-xl border border-gray-700 relative pl-4 cursor-pointer hover:border-yellow-500 transition-all"
                    >
                       <div className="absolute left-0 top-0 bottom-0 w-1 bg-yellow-500 rounded-l-xl"></div>
                       <div className="flex justify-between items-center mb-2">
                          <div className="font-bold text-gray-100">{item.stock_name}</div>
                          <div className="text-xs bg-yellow-900/40 text-yellow-200 px-2 py-1 rounded">
                            Gap: {item.gap_pct.toFixed(2)}%
                          </div>
                       </div>
                       <div className="flex justify-between items-end text-sm">
                          <div className="text-gray-400 text-xs">
                             <div>현재: {item.current_price.toLocaleString()}</div>
                             <div>목표: <span className="text-yellow-200">{parseInt(item.target_buy_price).toLocaleString()}</span></div>
                          </div>
                          <div className="text-right">
                             <div className="text-xs text-gray-500">기대수익</div>
                             <div className={`font-bold ${item.current_upside < 4.0 ? 'text-red-400' : 'text-green-400'}`}>
                               {item.current_upside.toFixed(2)}%
                             </div>
                          </div>
                       </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ============================================================
                3. 익절 완료 (Profit)
               ============================================================ */}
            <section>
              <h2 className="text-lg md:text-xl font-bold text-green-400 mb-3 flex items-center justify-between">
                <span>🏆 익절 완료 종목</span>
                <span className="bg-green-900/50 text-green-300 text-xs px-2 py-1 rounded-full">{result.profit_list.length}개</span>
              </h2>

              {result.profit_list.length === 0 ? (
                <div className="p-8 text-center bg-gray-800 rounded-lg text-gray-500 border border-gray-700">수익 실현 종목이 없습니다.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {result.profit_list.map((item: any) => {
                    const netProfit = item.final_asset - 10000000;
                    return (
                      <div 
                        key={item.ticker} 
                        onClick={() => setSelectedStock(item)}
                        className="bg-gray-800 p-4 rounded-xl border border-gray-700 flex justify-between items-center cursor-pointer hover:border-green-500 transition-all"
                      >
                        <div>
                          <div className="font-bold text-gray-100">{item.stock_name}</div>
                          <div className="text-xs text-gray-500">순수익: <span className="text-red-400">+{parseInt(netProfit.toString()).toLocaleString()}원</span></div>
                        </div>
                        <div className="text-right">
                           <div className="text-2xl font-bold text-red-500">+{item.return_rate.toFixed(1)}%</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            {/* ============================================================
                4. 손실 종목 (Loss)
               ============================================================ */}
            {result.loss_list.length > 0 && (
              <section>
                <h2 className="text-lg md:text-xl font-bold text-blue-400 mb-3">
                  💀 손실 발생 종목 ({result.loss_list.length}개)
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {result.loss_list.map((item: any) => (
                    <div 
                      key={item.ticker} 
                      onClick={() => setSelectedStock(item)}
                      className="bg-gray-800/50 p-3 rounded border border-gray-700 flex justify-between items-center text-sm cursor-pointer hover:bg-gray-700"
                    >
                      <span className="text-gray-300 truncate mr-2">{item.stock_name}</span>
                      <span className="text-blue-400 font-bold whitespace-nowrap">{item.return_rate.toFixed(2)}%</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* 로그 창 */}
        <div className="bg-black/50 p-4 rounded-lg border border-gray-800 mt-8">
          <div className="font-bold mb-2 text-gray-400 text-xs uppercase tracking-wider">System Logs</div>
          <div className="h-32 overflow-y-auto text-xs text-gray-500 font-mono space-y-1">
            {logs.length === 0 ? <div className="opacity-30">대기 중...</div> : logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
      </div>

      {/* ============================================================
          ★ 상세 내역 모달 (Modal)
         ============================================================ */}
      {selectedStock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setSelectedStock(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-hidden shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            
            {/* 모달 헤더 */}
            <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900 sticky top-0">
              <div>
                <h2 className="text-xl font-bold text-white">{selectedStock.stock_name}</h2>
                <p className="text-xs text-gray-500">{selectedStock.ticker}</p>
              </div>
              <button onClick={() => setSelectedStock(null)} className="text-gray-400 hover:text-white p-2">✕</button>
            </div>

            {/* 모달 내용 (스크롤 가능) */}
            <div className="p-5 overflow-y-auto flex-1 space-y-4">
              
              {/* 요약 정보 */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-gray-800 p-3 rounded-lg text-center">
                  <div className="text-xs text-gray-500">현재가</div>
                  <div className="font-bold text-lg">{selectedStock.current_price.toLocaleString()}원</div>
                </div>
                <div className="bg-gray-800 p-3 rounded-lg text-center">
                  <div className="text-xs text-gray-500">수익률</div>
                  <div className={`font-bold text-lg ${selectedStock.return_rate > 0 ? 'text-red-400' : 'text-blue-400'}`}>
                    {selectedStock.return_rate ? selectedStock.return_rate.toFixed(2) : 0}%
                  </div>
                </div>
              </div>

              {/* 거래 내역 리스트 */}
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Transaction History</h3>
              
              {(!selectedStock.trade_history || selectedStock.trade_history.length === 0) ? (
                <div className="text-center text-gray-600 py-8">거래 내역이 없습니다.</div>
              ) : (
                <div className="space-y-3">
                  {selectedStock.trade_history.map((log: any, idx: number) => (
                    <div key={idx} className="bg-gray-800/50 p-3 rounded-lg border border-gray-700/50 flex justify-between items-center text-sm">
                      
                      {/* 왼쪽: 날짜 및 타입 */}
                      <div>
                        <div className="text-xs text-gray-500 mb-1">{log.date}</div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                            log.type.includes("매수") 
                              ? "bg-blue-900/30 text-blue-300 border border-blue-800" 
                              : "bg-red-900/30 text-red-300 border border-red-800"
                          }`}>
                            {log.type}
                          </span>
                          <span className="text-gray-300 text-xs">{log.detail}</span>
                        </div>
                      </div>

                      {/* 오른쪽: 가격 및 수량 */}
                      <div className="text-right">
                        <div className="font-bold text-gray-200">{parseInt(log.price).toLocaleString()}원</div>
                        <div className="text-xs text-gray-500">{log.qty}주</div>
                        {log.profit_rate !== 0 && (
                          <div className={`text-xs font-bold mt-1 ${log.profit_rate > 0 ? 'text-red-400' : 'text-blue-400'}`}>
                            {log.profit_rate > 0 ? "+" : ""}{log.profit_rate.toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 모달 푸터 */}
            <div className="p-4 border-t border-gray-800 bg-gray-900 text-center">
              <button onClick={() => setSelectedStock(null)} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 py-3 rounded-lg transition-colors font-bold">
                닫기
              </button>
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}
