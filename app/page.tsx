"use client";

import { useState } from "react";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      // 위에서 설정한 rewrite 덕분에 파이썬 파일이 실행됩니다.
      const res = await fetch("/api/analyze");
      const json = await res.json();
      setData(json);
    } catch (error) {
      console.error(error);
      alert("분석 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 bg-gray-100 flex flex-col items-center">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">주식 퀀트 분석기</h1>
      
      <button
        onClick={runAnalysis}
        disabled={loading}
        className="px-6 py-3 bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 disabled:bg-gray-400 transition"
      >
        {loading ? "데이터 분석 중..." : "분석 시작"}
      </button>

      {data && (
        <div className="mt-8 w-full max-w-4xl bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-4 text-gray-700">
            분석 결과: 총 {data.total}개 중 {data.waiting_list.length}개 대기
          </h2>
          
          {data.waiting_list.length > 0 ? (
            <ul className="space-y-3">
              {data.waiting_list.map((item: any) => (
                <li key={item.ticker} className="p-4 border rounded flex justify-between items-center hover:bg-gray-50">
                  <div>
                    <span className="font-bold text-lg text-gray-900">{item.stock_name}</span>
                    <span className="text-sm text-gray-500 ml-2">({item.ticker})</span>
                  </div>
                  <div className="text-right">
                    <div className="text-orange-600 font-bold">Gap: {item.gap_pct}%</div>
                    <div className="text-sm text-gray-600">현재가: {item.current_price.toLocaleString()}원</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500 text-center py-10">조건에 맞는 종목이 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}
