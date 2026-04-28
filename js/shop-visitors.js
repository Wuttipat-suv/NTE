// ============================================================
// Visitor counter — daily unique + all-time (Firestore)
// ============================================================

const VISITOR_STORAGE_KEY = 'lastVisitDate';

function getTodayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function trackVisitor() {
  const today = getTodayKey();
  const lastVisit = localStorage.getItem(VISITOR_STORAGE_KEY);
  if (lastVisit === today) {
    loadTodayCount();
    return;
  }

  try {
    const batch = db.batch();
    const dailyRef = db.collection('visitors').doc(today);
    const totalRef = db.collection('visitors').doc('_total');

    batch.set(dailyRef, {
      count: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });

    batch.set(totalRef, {
      count: firebase.firestore.FieldValue.increment(1)
    }, { merge: true });

    await batch.commit();
    localStorage.setItem(VISITOR_STORAGE_KEY, today);
  } catch (e) {
    console.warn('visitor track failed:', e.message);
  }

  loadTodayCount();
}

function loadTodayCount() {
  const today = getTodayKey();
  db.collection('visitors').doc(today).onSnapshot(doc => {
    const count = doc.exists ? (doc.data().count || 0) : 0;
    const el = document.getElementById('visitorTodayCount');
    if (el) el.textContent = count;
  }, () => {});
}

function loadTotalCount() {
  db.collection('visitors').doc('_total').onSnapshot(doc => {
    const count = doc.exists ? (doc.data().count || 0) : 0;
    const el = document.getElementById('visitorTotalCount');
    if (el) el.textContent = count.toLocaleString();
  }, () => {});
}
