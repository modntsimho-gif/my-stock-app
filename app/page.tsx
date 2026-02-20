"use client";
import { useState } from "react";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

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
              // 너무 빠르게 지나가므로 로그에는 가끔만 추가하거나 생략 가능
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
    <div className="min-h-screen bg-gray-900 text-gray-200 p-6 font-mono text-sm">
      <h1 className="text-2xl font-bold mb-4 text-green-400">📈 퀀트 분석기 (Vercel Edition)</h1>

      {/* 컨트롤 패널 */}
      <div className="mb-6">
        <button
          onClick={runAnalysis}
          disabled={loading}
          className={`px-6 py-3 rounded font-bold ${
            loading ? "bg-gray-600 cursor-not-allowed" : "bg-green-600 hover:bg-green-500 text-white"
          }`}
        >
          {loading ? `분석 중... (${progress.current}/${progress.total})` : "분석 시작"}
        </button>
        
        {/* 진행률 바 */}
        {loading && progress.total > 0 && (
          <div className="w-full bg-gray-700 h-4 rounded mt-3 overflow-hidden">
            <div
              className="bg-green-500 h-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            ></div>
          </div>
        )}
      </div>

      {/* 결과 화면 */}
      {result && (
        <div className="space-y-8">
          {/* 1. 보유 종목 */}
          <section className="bg-gray-800 p-4 rounded border border-gray-700">
            <h2 className="text-xl font-bold text-red-400 mb-2">
              🔥 [현재 보유 중인 종목] 총 {result.holding_list.length}개
            </h2>
            <p className="text-gray-400 mb-4 text-xs">매도 신호 미발생 종목</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-700 text-gray-300">
                  <tr>
                    <th className="p-2">종목명</th>
                    <th className="p-2">매수일</th>
                    <th className="p-2 text-right">현재가</th>
                    <th className="p-2 text-right">평단가</th>
                    <th className="p-2 text-center">물타기</th>
                    <th className="p-2 text-right">수익률</th>
                    <th className="p-2 text-center">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {result.holding_list.length === 0 ? (
                    <tr><td colSpan={7} className="p-4 text-center text-gray-500">보유 중인 종목이 없습니다.</td></tr>
                  ) : (
                    result.holding_list.map((item: any) => {
                      const rate = ((item.current_price - item.avg_price) / item.avg_price) * 100;
                      return (
                        <tr key={item.ticker} className="hover:bg-gray-700">
                          <td className="p-2">{item.stock_name}<span className="text-xs text-gray-500 ml-1">({item.ticker})</span></td>
                          <td className="p-2">{item.first_buy_date}</td>
                          <td className="p-2 text-right">{item.current_price.toLocaleString()}원</td>
                          <td className="p-2 text-right">{parseInt(item.avg_price).toLocaleString()}원</td>
                          <td className="p-2 text-center">{item.buy_count}회</td>
                          <td className={`p-2 text-right font-bold ${rate > 0 ? "text-red-400" : "text-blue-400"}`}>
                            {rate.toFixed(2)}%
                          </td>
                          <td className="p-2 text-center">{rate > 0 ? "🔴수익" : "🔵손실"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* 2. 매수 대기 */}
          <section className="bg-gray-800 p-4 rounded border border-gray-700">
            <h2 className="text-xl font-bold text-yellow-400 mb-2">
              ⏳ [매수 대기] BB하단 접근 (4% 이내) - 총 {result.waiting_list.length}개
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-700 text-gray-300">
                  <tr>
                    <th className="p-2">종목명</th>
                    <th className="p-2 text-right">현재가</th>
                    <th className="p-2 text-right">매수목표가(BB하단)</th>
                    <th className="p-2 text-right">남은거리(Gap)</th>
                    <th className="p-2 text-right">기대수익률</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {result.waiting_list.length === 0 ? (
                    <tr><td colSpan={5} className="p-4 text-center text-gray-500">대기 중인 종목이 없습니다.</td></tr>
                  ) : (
                    result.waiting_list.map((item: any) => (
                      <tr key={item.ticker} className="hover:bg-gray-700">
                        <td className="p-2">{item.stock_name}<span className="text-xs text-gray-500 ml-1">({item.ticker})</span></td>
                        <td className="p-2 text-right">{item.current_price.toLocaleString()}원</td>
                        <td className="p-2 text-right text-yellow-200">{parseInt(item.target_buy_price).toLocaleString()}원</td>
                        <td className="p-2 text-right font-bold text-yellow-400">{item.gap_pct.toFixed(2)}%</td>
                        <td className="p-2 text-right">
                          {item.current_upside.toFixed(2)}%
                          {item.current_upside < 4.0 && <span className="text-red-400 text-xs ml-1">(낮음)</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* 3. 손실 종목 */}
          <section className="bg-gray-800 p-4 rounded border border-gray-700">
            <h2 className="text-xl font-bold text-blue-400 mb-2">
              💀 누적 손실 발생 종목 - 총 {result.loss_list.length}개
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {result.loss_list.map((item: any) => (
                    <div key={item.ticker} className="bg-gray-900 p-2 rounded border border-gray-700 flex justify-between">
                        <span>{item.stock_name}</span>
                        <span className="text-blue-400 font-bold">{item.return_rate.toFixed(2)}%</span>
                    </div>
                ))}
            </div>
          </section>
        </div>
      )}

      {/* 로그 창 */}
      <div className="mt-8 bg-black p-4 rounded h-48 overflow-y-auto border border-gray-800 text-xs text-gray-500">
        <div className="font-bold mb-2 text-gray-300">System Logs:</div>
        {logs.map((log, i) => (
          <div key={i}>{log}</div>
        ))}
      </div>
    </div>
  );
}
