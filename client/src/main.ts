import { AuctionRoomScene, BIDDER_SEATS } from './scene/auction-room.js';
import { AuctionNetworkClient, type BidResult } from './network.js';

let scene: AuctionRoomScene;
let network: AuctionNetworkClient;

let activeBidder = BIDDER_SEATS[0]; // Alice by default
const bidderTokens: Record<string, string> = {};

let auctionEndsAt: Date | null = null;
let currentPriceCents = 0;
let minIncrementCents = 100;
let auctionStatus = 'open';

// DOM elements
const canvasContainer = document.getElementById('canvas-container')!;
const lotTitleEl = document.getElementById('lot-title')!;
const auctionIdEl = document.getElementById('auction-id-display')!;
const seqCounterEl = document.getElementById('seq-counter')!;
const auctionStatusEl = document.getElementById('auction-status')!;
const connectionPillEl = document.getElementById('connection-pill')!;
const statusLabelEl = document.getElementById('status-label')!;
const reconnectBannerEl = document.getElementById('reconnect-banner')!;
const reconnectSeqInfoEl = document.getElementById('reconnect-seq-info')!;
const toastContainerEl = document.getElementById('toast-container')!;
const seatButtonsContainer = document.getElementById('seat-buttons')!;
const activeBidderLabelEl = document.getElementById('active-bidder-label')!;
const minBidHintEl = document.getElementById('min-bid-hint')!;
const bidAmountInput = document.getElementById('bid-amount-input') as HTMLInputElement;
const btnSubmitBid = document.getElementById('btn-submit-bid') as HTMLButtonElement;
const submitButtonTextEl = document.getElementById('submit-button-text')!;
const eventFeedEl = document.getElementById('event-feed')!;
const toggleMotionBtn = document.getElementById('toggle-motion-btn')!;
const chaosTriggerBtn = document.getElementById('chaos-trigger-btn')!;

// 1. Initialize 3D Scene
scene = new AuctionRoomScene(canvasContainer);

// 3D Scene interaction: clicking a bidder station selects that seat!
scene.onSeatClicked = (seatIndex: number) => {
  if (BIDDER_SEATS[seatIndex]) {
    selectBidder(BIDDER_SEATS[seatIndex]);
    showToast(`Switched seat to ${BIDDER_SEATS[seatIndex].name}`, 'info');
  }
};

// 2. Fetch Bidder Tokens from Backend
async function fetchBidderTokens() {
  for (const b of BIDDER_SEATS) {
    try {
      const res = await fetch(`/auth/token?bidder_id=${b.id}`);
      if (res.ok) {
        const data = await res.json();
        bidderTokens[b.id] = data.token;
      }
    } catch {
      // offline fallback
    }
  }
}

// 3. Render Seat Buttons
function renderSeatButtons() {
  seatButtonsContainer.innerHTML = '';
  for (const seat of BIDDER_SEATS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `seat-btn ${seat.id === activeBidder.id ? 'active' : ''}`;
    btn.innerHTML = `
      <span class="seat-pip" style="background: ${seat.color}; box-shadow: 0 0 8px ${seat.color}"></span>
      <span>${seat.name}</span>
    `;
    btn.onclick = () => {
      selectBidder(seat);
    };
    seatButtonsContainer.appendChild(btn);
  }
  activeBidderLabelEl.textContent = `Bidding as: ${activeBidder.name}`;
  activeBidderLabelEl.style.color = activeBidder.color;
  scene.setActiveSeat(activeBidder.seatIndex);
}

function selectBidder(seat: typeof BIDDER_SEATS[0]) {
  activeBidder = seat;
  renderSeatButtons();
  if (bidderTokens[seat.id]) {
    network.setToken(bidderTokens[seat.id]);
  }
}

// 4. Toast Notifications
function showToast(message: string, type: 'info' | 'rejected' | 'extended' = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainerEl.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

// 5. Update Bid Hint and Dynamic Button Label
function updateBidHint() {
  const minRequiredCents = currentPriceCents + minIncrementCents;
  const minDollars = (minRequiredCents / 100).toFixed(2);
  minBidHintEl.textContent = `Min bid: $${minDollars} (+$${(minIncrementCents / 100).toFixed(2)})`;

  const curVal = parseFloat(bidAmountInput.value);
  if (isNaN(curVal) || curVal * 100 < minRequiredCents) {
    bidAmountInput.value = Math.ceil(minRequiredCents / 100).toString();
  }
  updateSubmitButtonLabel();
}

function updateSubmitButtonLabel() {
  const val = parseFloat(bidAmountInput.value);
  if (!isNaN(val) && val > 0) {
    submitButtonTextEl.textContent = `PLACE BID ($${val.toFixed(2)})`;
  } else {
    submitButtonTextEl.textContent = `PLACE BID`;
  }
}

// 6. Append Feed Item
function addFeedItem(type: string, seq: number, title: string, amountCents?: number, extra?: string) {
  const item = document.createElement('div');
  item.className = `feed-item ${type}`;

  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  item.innerHTML = `
    <div class="feed-item-top">
      <span class="feed-seq">SEQ #${seq}</span>
      <span class="feed-time">${timeStr}</span>
    </div>
    <div class="feed-item-main">
      <span class="feed-bidder">${title}</span>
      ${amountCents ? `<span class="feed-amount">$${(amountCents / 100).toFixed(2)}</span>` : ''}
    </div>
    ${extra ? `<div style="font-size: 11px; color: var(--gold-bright); font-weight: 600;">${extra}</div>` : ''}
  `;

  eventFeedEl.insertBefore(item, eventFeedEl.firstChild);
}

// 7. Initialize Network Client
network = new AuctionNetworkClient({
  onConnectionChange: (connected, lastSeq) => {
    scene.setConnectedState(connected);
    if (connected) {
      connectionPillEl.className = 'connection-status';
      statusLabelEl.textContent = 'CONNECTED';
      reconnectBannerEl.classList.add('hidden');
    } else {
      connectionPillEl.className = 'connection-status reconnecting';
      statusLabelEl.textContent = 'RECONNECTING';
      reconnectSeqInfoEl.textContent = `Last observed state: Seq #${lastSeq}`;
      reconnectBannerEl.classList.remove('hidden');
    }
  },

  onSnapshot: (snap) => {
    const auction = snap.auction;
    lotTitleEl.textContent = auction.title;
    auctionIdEl.textContent = `ID: ${auction.id.slice(0, 8)}...`;
    seqCounterEl.textContent = `SEQ #${snap.current_seq}`;

    currentPriceCents = Number(auction.current_price_cents);
    minIncrementCents = Number(auction.min_increment_cents);
    auctionStatus = auction.status;
    auctionEndsAt = new Date(auction.ends_at);

    scene.odometer.setValue(currentPriceCents, true);
    updateBidHint();

    if (auction.status === 'closed') {
      auctionStatusEl.textContent = 'CLOSED';
      auctionStatusEl.className = 'badge closed';
      btnSubmitBid.disabled = true;
    } else {
      auctionStatusEl.textContent = 'LIVE LOT';
      auctionStatusEl.className = 'badge';
      btnSubmitBid.disabled = false;
    }

    eventFeedEl.innerHTML = '';
    if (snap.recent_events) {
      for (const ev of snap.recent_events) {
        if (ev.type === 'bid_accepted') {
          const bidder = BIDDER_SEATS.find((b) => b.id === ev.payload.bidder_id);
          addFeedItem(
            'accepted',
            ev.seq,
            bidder ? bidder.name : ev.payload.bidder_id,
            ev.payload.amount_cents,
            ev.payload.extended ? 'Anti-sniping +30s' : undefined
          );
        } else if (ev.type === 'auction_closed') {
          addFeedItem('closed', ev.seq, 'AUCTION CONCLUDED', ev.payload.final_price_cents);
        }
      }
    }
  },

  onEvent: (ev) => {
    seqCounterEl.textContent = `SEQ #${ev.seq}`;

    if (ev.event_type === 'bid_accepted') {
      currentPriceCents = Number(ev.payload.current_price_cents);
      scene.odometer.setValue(currentPriceCents);

      if (ev.payload.ends_at) {
        auctionEndsAt = new Date(ev.payload.ends_at);
      }

      // Find winner seat
      const winner = BIDDER_SEATS.find((b) => b.id === ev.payload.bidder_id);
      const seatIndex = winner ? winner.seatIndex : 0;
      const color = winner ? winner.color : '#d4af37';

      // 3D shockwave pulse from winner seat
      scene.triggerAcceptedBid(seatIndex, color);

      // Anti-sniping visual extension
      if (ev.payload.extended) {
        scene.triggerAntiSnipeExtension();
        showToast('ANTI-SNIPING EXTENSION: +30 SECONDS ADDED', 'extended');
      }

      addFeedItem(
        'accepted',
        ev.seq,
        winner ? winner.name : ev.payload.bidder_id,
        ev.payload.amount_cents,
        ev.payload.extended ? 'Anti-sniping +30s' : undefined
      );

      updateBidHint();
    } else if (ev.event_type === 'auction_closed') {
      auctionStatus = 'closed';
      auctionStatusEl.textContent = 'CLOSED';
      auctionStatusEl.className = 'badge closed';
      btnSubmitBid.disabled = true;
      showToast('AUCTION CONCLUDED: LOT HAMMERED DOWN', 'info');
      addFeedItem('closed', ev.seq, 'AUCTION CONCLUDED', ev.payload.final_price_cents);
    }
  },

  onEventsReplay: (events) => {
    for (const ev of events) {
      seqCounterEl.textContent = `SEQ #${ev.seq}`;
      if (ev.type === 'bid_accepted') {
        currentPriceCents = Number(ev.payload.current_price_cents);
        scene.odometer.setValue(currentPriceCents);
        if (ev.payload.ends_at) {
          auctionEndsAt = new Date(ev.payload.ends_at);
        }
        const winner = BIDDER_SEATS.find((b) => b.id === ev.payload.bidder_id);
        addFeedItem(
          'accepted',
          ev.seq,
          winner ? winner.name : ev.payload.bidder_id,
          ev.payload.amount_cents
        );
      }
    }
    updateBidHint();
  },

  onBidResult: (result: BidResult) => {
    if (!result.accepted) {
      // Race condition resolution: visually signal rejection to this bidder
      scene.triggerRejectedBidFeedback();
      const currentDollars = (result.current_price_cents / 100).toFixed(2);
      showToast(`BID REJECTED: ${result.reject_reason?.toUpperCase()} (Current: $${currentDollars})`, 'rejected');
    } else {
      showToast(`BID ACCEPTED: $${(result.amount_cents / 100).toFixed(2)}`, 'info');
    }
  },

  onError: (errMsg) => {
    showToast(`ERROR: ${errMsg}`, 'rejected');
  },
});

// 8. Bootstrap Auction Connection
async function bootstrap() {
  await fetchBidderTokens();
  renderSeatButtons();

  try {
    const res = await fetch('/auctions');
    const data = await res.json();
    let targetAuction = data.auctions?.find((a: any) => a.status === 'open');

    // If no open auction exists, or it expires in less than 2 minutes, create a fresh live lot
    if (!targetAuction || new Date(targetAuction.ends_at).getTime() - Date.now() < 120000) {
      const createRes = await fetch('/auctions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Lot #101: 18th-Century Celestial Orrery',
          starting_price_cents: 5000,
          min_increment_cents: 500,
          ends_at: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
        }),
      });
      const createData = await createRes.json();
      targetAuction = createData.auction;
    }

    network.connect(targetAuction.id, bidderTokens[activeBidder.id]);
  } catch (err) {
    console.error('Failed to bootstrap auction:', err);
    showToast('Failed to connect to backend server', 'rejected');
  }
}

// 9. Form Submission for Bids
async function submitBid() {
  const dollars = parseFloat(bidAmountInput.value);
  if (isNaN(dollars) || dollars <= 0) return;

  const cents = Math.round(dollars * 100);
  btnSubmitBid.disabled = true;

  try {
    await network.placeBid(cents);
  } catch (err: any) {
    showToast(`BID FAILED: ${err.message}`, 'rejected');
  } finally {
    if (auctionStatus === 'open') {
      btnSubmitBid.disabled = false;
    }
  }
}

document.getElementById('bid-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  submitBid();
});

bidAmountInput.addEventListener('input', () => {
  updateSubmitButtonLabel();
});

// Quick increment buttons
document.querySelectorAll('.btn-inc').forEach((btn) => {
  btn.addEventListener('click', () => {
    const add = parseInt(btn.getAttribute('data-add') || '0', 10);
    const cur = parseFloat(bidAmountInput.value) || Math.ceil((currentPriceCents + minIncrementCents) / 100);
    bidAmountInput.value = (cur + add).toString();
    updateSubmitButtonLabel();
  });
});

// Camera motion toggle
toggleMotionBtn.addEventListener('click', () => {
  const isOrbiting = scene.toggleMotion();
  toggleMotionBtn.textContent = `Motion: ${isOrbiting ? 'Auto' : 'Static'}`;
});

// Chaos drop simulation
chaosTriggerBtn.addEventListener('click', () => {
  network.simulateDrop();
});

// 10. Animation Loop
let lastFrameTime = performance.now();

function updateCountdown() {
  if (!auctionEndsAt) return;
  const now = Date.now();
  const diff = Math.max(0, auctionEndsAt.getTime() - now);
  scene.setCountdown(diff, 25 * 60 * 1000); // 25-minute scale
}

function animate(now: number) {
  requestAnimationFrame(animate);
  const delta = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  scene.render(delta);
  updateCountdown();
}

requestAnimationFrame(animate);
bootstrap();
