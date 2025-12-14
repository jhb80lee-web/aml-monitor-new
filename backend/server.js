// backend/server.js
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 3000;

// 모든 출처 허용 (앱/브라우저에서 접속 가능하게)
app.use(cors());
app.use(express.json());

// ---------- 1. OFAC 최신 ----------
app.get("/ofac/latest", (req, res) => {
  const data = {
    lastUpdated: "2025-11-30 12:34 (KST)",
    prevSnapshotLabel: "2025-11-15",
    curSnapshotLabel: "2025-11-30",
    prevTotalCount: 15000,
    curTotalCount: 15020,
    prevKrCount: 10,
    curKrCount: 11,
    krCurrent: [
      {
        id: "OFAC001",
        name: "KIM, CHUL SOO",
        birth: "1975-01-01",
        nationality: "Korea, Republic of",
        program: "DPRK2",
      },
    ],
    krAdded: [],
    krRemoved: [],
  };

  res.json(data);
});

// ---------- 2. UN 최신 ----------
app.get("/un/latest", (req, res) => {
  const data = {
    lastUpdated: "2025-11-30 12:34 (KST)",
    prevSnapshotLabel: "2025-11-15",
    curSnapshotLabel: "2025-11-30",
    prevTotalCount: 600,
    curTotalCount: 605,
    prevKrCount: 5,
    curKrCount: 5,
    krCurrent: [],
    krAdded: [],
    krRemoved: [],
  };

  res.json(data);
});

// ---------- 3. KoFIU VASP 최신 ----------
app.get("/kofiu/vasp/latest", (req, res) => {
  const data = {
    lastUpdated: "2025-11-25 공지 기준",
    totalCount: 27,
    activeCount: 24,
    newCount: 1,
    closedCount: 0,
    current: [
      {
        id: "VASP001",
        name: "업비트",
        serviceName: "Upbit",
        status: "영업 중",
      },
    ],
    newlyRegistered: [],
    closed: [],
  };

  res.json(data);
});

// ---------- 4. KoFIU 제한대상 최신 ----------
app.get("/kofiu/restricted/latest", (req, res) => {
  const data = {
    lastUpdated: "2025-11-20 공시 기준",
    totalCount: 5,
    items: [
      { id: "1", name: "홍길동", birth: "1985-01-01", nationality: "대한민국" },
      { id: "2", name: "김제재", birth: "1979-03-15", nationality: "대한민국" },
      { id: "3", name: "ABC 상사", nationality: "대한민국" },
      { id: "4", name: "John Doe", birth: "1980-05-12", nationality: "미국" },
      { id: "5", name: "Sample Corp.", nationality: "" },
    ],
  };

  res.json(data);
});

// ---------- 서버 시작 ----------
app.listen(PORT, () => {
  console.log(`API 서버가 http://localhost:${PORT} 에서 실행 중`);
});
