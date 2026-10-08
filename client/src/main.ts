import { AuctionRoomScene, BIDDER_SEATS, type BidderSeatConfig } from './scene/auction-room.js';
import {
  AuctionNetworkClient,
  apiRequest,
  type BidResult,
  getCustomServerUrl,
  setCustomServerUrl,
  getApiBaseUrl,
  isSimulationMode,
  setForcedDemoMode,
} from './network.js';
import { simulationEngine } from './simulation.js';
import { sounds } from './sound.js';

interface CurrentUser {
  id: string;
  username: string;
  email: string;
  role: 'bidder' | 'admin';
  paddle_number: string;
  avatar_color: string;
  seat_index: number;
}

let scene: AuctionRoomScene;
let network: AuctionNetworkClient;

let activeBidder = BIDDER_SEATS[0]; // Alice by default
let currentUser: CurrentUser | null = null;
const bidderTokens: Record<string, string> = {};

let currentAuctionId: string | null = null;
let auctionEndsAt: Date | null = null;
let currentPriceCents = 0;
let minIncrementCents = 100;
let auctionStatus = 'open';
let currentWinnerId: string | null = null;
let currentWinnerName: string | null = null;

// DOM elements - Main Saleroom
const canvasContainer = document.getElementById('canvas-container')!;
const lotTitleEl = document.getElementById('lot-title')!;
const auctionIdEl = document.getElementById('auction-id-display')!;
const seqCounterEl = document.getElementById('seq-counter')!;
const auctionStatusEl = document.getElementById('auction-status')!;
const auctionTimerBadgeEl = document.getElementById('auction-timer-badge')!;
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
const toggleSoundBtn = document.getElementById('toggle-sound-btn')!;

// DOM elements - User Identity Widget & Modals
const userAvatarPipEl = document.getElementById('user-avatar-pip')!;
const userNameLabelEl = document.getElementById('user-name-label')!;
const authModalBtn = document.getElementById('auth-modal-btn')!;
const adminDeckBtn = document.getElementById('admin-deck-btn')!;

const authModalEl = document.getElementById('auth-modal')!;
const authModalCloseBtn = document.getElementById('auth-modal-close')!;
const quickVipGridEl = document.getElementById('quick-vip-grid')!;
const loginFormEl = document.getElementById('login-form') as HTMLFormElement;
const registerFormEl = document.getElementById('register-form') as HTMLFormElement;
const loginFeedbackEl = document.getElementById('login-feedback')!;
const registerFeedbackEl = document.getElementById('register-feedback')!;

// DOM elements - Admin Deck Modal
const adminModalEl = document.getElementById('admin-modal')!;
const adminModalCloseBtn = document.getElementById('admin-modal-close')!;
const adminLiveTitleEl = document.getElementById('admin-live-title')!;
const adminLivePriceEl = document.getElementById('admin-live-price')!;
const adminLiveIncrementEl = document.getElementById('admin-live-increment')!;
const adminNextTitleEl = document.getElementById('admin-next-title')!;
const adminNextDescEl = document.getElementById('admin-next-desc')!;
const adminNextEstimateEl = document.getElementById('admin-next-estimate')!;
const adminNextStartEl = document.getElementById('admin-next-start')!;
const adminLaunchNextBtn = document.getElementById('admin-launch-next-btn') as HTMLButtonElement;
const adminStrikeGavelBtn = document.getElementById('admin-strike-gavel-btn')!;
const adminExtendTimeBtn = document.getElementById('admin-extend-time-btn')!;
const adminHammerDownBtn = document.getElementById('admin-hammer-down-btn')!;
const adminCatalogListEl = document.getElementById('admin-catalog-list')!;
const createLotFormEl = document.getElementById('create-lot-form') as HTMLFormElement;
const createLotFeedbackEl = document.getElementById('create-lot-feedback')!;

// Telemetry
const teleTotalAuctionsEl = document.getElementById('tele-total-auctions')!;
const teleAcceptedBidsEl = document.getElementById('tele-accepted-bids')!;
const teleBiddersCountEl = document.getElementById('tele-bidders-count')!;

// DOM elements - Server & Engine Modal
const serverModalEl = document.getElementById('server-modal')!;
const serverModalCloseBtn = document.getElementById('server-modal-close')!;
const serverSettingsBtn = document.getElementById('server-settings-btn')!;
const customServerInput = document.getElementById('custom-server-input') as HTMLInputElement;
const testServerBtn = document.getElementById('test-server-btn')!;
const serverTestFeedbackEl = document.getElementById('server-test-feedback')!;
const saveServerBtn = document.getElementById('save-server-btn')!;
const resetDemoBtn = document.getElementById('reset-demo-btn')!;
const toggleAiBiddersBtn = document.getElementById('toggle-ai-bidders-btn')!;
const serverStatusModeTitleEl = document.getElementById('server-status-mode-title')!;
const serverStatusModeDescEl = document.getElementById('server-status-mode-desc')!;
const serverStatusIndicatorEl = document.getElementById('server-status-indicator')!;

// 1. Initialize 3D Scene
scene = new AuctionRoomScene(canvasContainer);

// 3D Scene interaction: clicking a bidder station selects that seat!
scene.onSeatClicked = (seatIndex: number) => {
  if (BIDDER_SEATS[seatIndex]) {
    selectBidder(BIDDER_SEATS[seatIndex]);
    showToast(`Switched seat to ${BIDDER_SEATS[seatIndex].name}`, 'info');
  }
};

// 2. Toast Notifications
function showToast(message: string, type: 'info' | 'rejected' | 'extended' = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainerEl.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3500);
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
  activeBidderLabelEl.textContent = `Bidding as: ${currentUser?.username || activeBidder.name} (Paddle #${currentUser?.paddle_number || activeBidder.paddleNumber})`;
  activeBidderLabelEl.style.color = currentUser?.avatar_color || activeBidder.color;
  scene.setActiveSeat(activeBidder.seatIndex);
}

// Quick VIP Grid Generation
function renderQuickVipGrid() {
  if (!quickVipGridEl) return;
  quickVipGridEl.innerHTML = '';

  const vipList = [
    ...BIDDER_SEATS.map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
      paddle: s.paddleNumber,
      role: 'bidder' as const,
      seatIndex: s.seatIndex,
    })),
    {
      id: 'admin',
      name: 'Saleroom Master',
      color: '#ffd700',
      paddle: 'ADMIN',
      role: 'admin' as const,
      seatIndex: -1,
    },
  ];

  vipList.forEach((vip) => {
    const card = document.createElement('div');
    const isCurrent = currentUser?.username === vip.name.split(' ')[0] || activeBidder.id === vip.id;
    card.className = `quick-vip-card ${isCurrent ? 'active' : ''}`;
    card.innerHTML = `
      <div class="quick-vip-left">
        <span class="vip-pip" style="background: ${vip.color}; box-shadow: 0 0 8px ${vip.color}"></span>
        <div>
          <div class="vip-name">${vip.name}</div>
          <div class="vip-paddle">Paddle #${vip.paddle}</div>
        </div>
      </div>
      <span class="vip-badge-tag">${vip.role === 'admin' ? 'CURATOR' : 'SEAT ' + (vip.seatIndex + 1)}</span>
    `;

    card.onclick = async () => {
      try {
        const res = await apiRequest<{ token: string }>(`/auth/token?bidder_id=${vip.id}`);
        localStorage.setItem('auction_token', res.token);
        currentUser = {
          id: vip.id,
          username: vip.name.split(' ')[0],
          email: `${vip.id}@saleroom.vip`,
          role: vip.role,
          paddle_number: vip.paddle,
          avatar_color: vip.color,
          seat_index: vip.seatIndex >= 0 ? vip.seatIndex : 0,
        };
        localStorage.setItem('auction_user', JSON.stringify(currentUser));
        if (vip.seatIndex >= 0 && BIDDER_SEATS[vip.seatIndex]) {
          selectBidder(BIDDER_SEATS[vip.seatIndex]);
        } else {
          network.setToken(res.token);
          updateUserPillUI();
        }
        authModalEl.classList.add('hidden');
        showToast(`Admitted to saleroom as ${vip.name} (Paddle #${vip.paddle})`, 'info');
      } catch (err: any) {
        showToast(`Switch failed: ${err.message}`, 'rejected');
      }
    };

    quickVipGridEl.appendChild(card);
  });
}

function selectBidder(seat: BidderSeatConfig) {
  activeBidder = seat;
  if (!currentUser) {
    currentUser = {
      id: seat.id,
      username: seat.name.split(' ')[0],
      email: `${seat.id}@saleroom.vip`,
      role: 'bidder',
      paddle_number: seat.paddleNumber,
      avatar_color: seat.color,
      seat_index: seat.seatIndex,
    };
  } else {
    currentUser.id = seat.id;
    currentUser.username = seat.name.split(' ')[0];
    currentUser.paddle_number = seat.paddleNumber;
    currentUser.seat_index = seat.seatIndex;
    currentUser.avatar_color = seat.color;
  }
  scene.setActiveSeat(seat.seatIndex);
  updateUserPillUI();
  renderSeatButtons();
  updateBidHint();
  if (bidderTokens[seat.id]) {
    network.setToken(bidderTokens[seat.id]);
    localStorage.setItem('auction_token', bidderTokens[seat.id]);
  }
}

function updateUserPillUI() {
  if (currentUser) {
    userAvatarPipEl.style.background = currentUser.avatar_color;
    userAvatarPipEl.style.boxShadow = `0 0 8px ${currentUser.avatar_color}`;
    const roleBadge = currentUser.role === 'admin' ? '👑 Admin' : `#${currentUser.paddle_number}`;
    userNameLabelEl.textContent = `${currentUser.username} (${roleBadge})`;
  } else {
    userAvatarPipEl.style.background = activeBidder.color;
    userNameLabelEl.textContent = `${activeBidder.name} (#${activeBidder.paddleNumber})`;
  }
}

// 4. Update Bid Hint and Dynamic Button Label
function updateBidHint() {
  const minThresholdCents = currentPriceCents + minIncrementCents;
  const minValidDollars = minThresholdCents / 100;

  minBidHintEl.textContent = `Next min bid: $${minValidDollars.toFixed(2)} (Increment: +$${(minIncrementCents / 100).toFixed(2)})`;

  const curVal = parseFloat(bidAmountInput.value);
  if (isNaN(curVal) || curVal * 100 < minThresholdCents) {
    bidAmountInput.value = minValidDollars.toFixed(2);
  }
  updateSubmitButtonLabel();
}

function isCurrentBidderWinning(): boolean {
  if (!currentWinnerId && !currentWinnerName) return false;

  const identifiers = [
    activeBidder.id,
    activeBidder.name,
    activeBidder.name.split(' ')[0],
    activeBidder.paddleNumber,
    `#${activeBidder.paddleNumber}`,
    currentUser?.id,
    currentUser?.username,
    currentUser?.paddle_number,
    currentUser ? `#${currentUser.paddle_number}` : null,
  ].filter(Boolean) as string[];

  const leaderId = (currentWinnerId || '').toLowerCase().trim();
  const leaderName = (currentWinnerName || '').toLowerCase().trim();

  for (const ident of identifiers) {
    const clean = ident.toLowerCase().trim();
    if (!clean) continue;
    if (leaderId === clean || leaderId.includes(clean)) return true;
    if (leaderName === clean || leaderName.includes(clean)) return true;
  }
  return false;
}

function updateSubmitButtonLabel() {
  const isWinning = isCurrentBidderWinning();

  if (isWinning) {
    btnSubmitBid.disabled = true;
    submitButtonTextEl.textContent = `👑 YOU HOLD HIGH BID ($${(currentPriceCents / 100).toFixed(2)})`;
    btnSubmitBid.classList.add('holding-bid');
    minBidHintEl.innerHTML = `<span style="color: var(--gold-bright); font-weight: 600;">✨ You currently lead the auction. Awaiting counter-bids...</span>`;
    document.querySelectorAll('.btn-inc').forEach((btn) => {
      (btn as HTMLButtonElement).disabled = true;
    });
  } else {
    btnSubmitBid.disabled = auctionStatus !== 'open';
    btnSubmitBid.classList.remove('holding-bid');
    document.querySelectorAll('.btn-inc').forEach((btn) => {
      (btn as HTMLButtonElement).disabled = auctionStatus !== 'open';
    });
    if (currentWinnerName) {
      minBidHintEl.innerHTML = `Leader: <strong style="color: var(--gold-bright);">${currentWinnerName}</strong> &bull; Next min: $${((currentPriceCents + minIncrementCents) / 100).toFixed(2)}`;
    }
    const val = parseFloat(bidAmountInput.value);
    if (!isNaN(val) && val > 0) {
      submitButtonTextEl.textContent = `PLACE BID ($${val.toFixed(2)})`;
    } else {
      submitButtonTextEl.textContent = `PLACE BID`;
    }
  }
}

// 5. Append Feed Item
function renderEmptyFeedHint() {
  if (eventFeedEl.children.length === 0) {
    eventFeedEl.innerHTML = `
      <div class="feed-empty-hint">
        <div class="feed-empty-icon">🏛️</div>
        <h4>Saleroom Awaiting Bids</h4>
        <p>Select a VIP bidder below and place a bid to see paddles raise and gavels strike!</p>
      </div>
    `;
  }
}

function addFeedItem(type: string, seq: number, title: string, amountCents?: number, extra?: string) {
  const emptyHint = eventFeedEl.querySelector('.feed-empty-hint');
  if (emptyHint) emptyHint.remove();

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

// 6. Initialize Network Client
network = new AuctionNetworkClient({
  onConnectionChange: (connected, lastSeq, mode) => {
    scene.setConnectedState(connected);
    if (connected) {
      if (mode === 'simulation' || network.isSimulating) {
        connectionPillEl.className = 'connection-status simulation';
        statusLabelEl.textContent = 'DEMO ENGINE';
      } else {
        connectionPillEl.className = 'connection-status';
        statusLabelEl.textContent = 'LIVE BACKEND';
      }
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
    currentAuctionId = auction.id;
    lotTitleEl.textContent = auction.title;
    auctionIdEl.textContent = `ID: ${auction.id.slice(0, 8)}...`;
    seqCounterEl.textContent = `SEQ #${snap.current_seq}`;

    currentPriceCents = Number(auction.current_price_cents);
    minIncrementCents = Number(auction.min_increment_cents);
    auctionStatus = auction.status;
    auctionEndsAt = new Date(auction.ends_at);
    currentWinnerId = auction.current_winner_id || snap.recent_events?.find((e: any) => e.type === 'bid_accepted')?.payload?.bidder_id || null;
    currentWinnerName = auction.current_winner_name || null;

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
            ev.payload.extended ? '+10s' : undefined
          );
        } else if (ev.type === 'auction_closed') {
          addFeedItem('closed', ev.seq, 'AUCTION CONCLUDED', ev.payload.final_price_cents);
        }
      }
    }
    renderEmptyFeedHint();
  },

  onEvent: (ev) => {
    seqCounterEl.textContent = `SEQ #${ev.seq}`;

    if (ev.event_type === 'bid_accepted') {
      currentPriceCents = Number(ev.payload.current_price_cents);
      currentWinnerId = ev.payload.bidder_id;
      currentWinnerName = ev.payload.bidder_name;
      scene.odometer.setValue(currentPriceCents);

      if (ev.payload.ends_at) {
        auctionEndsAt = new Date(ev.payload.ends_at);
      }

      // Audio chime
      sounds.playBidChime();

      // Find winner seat
      const winner = BIDDER_SEATS.find((b) => b.id === ev.payload.bidder_id || b.name.includes(ev.payload.bidder_id));
      const seatIndex = winner ? winner.seatIndex : (currentUser?.seat_index ?? 0);
      const color = winner ? winner.color : (currentUser?.avatar_color ?? '#d4af37');

      // 3D shockwave pulse from winner seat
      scene.triggerAcceptedBid(seatIndex, color);

      // Anti-sniping visual extension (+10s added!)
      if (ev.payload.extended) {
        scene.triggerAntiSnipeExtension();
        sounds.playAntiSnipingAlert();
        showToast('ANTI-SNIPING EXTENSION: +10 SECONDS ADDED', 'extended');
      }

      addFeedItem(
        'accepted',
        ev.seq,
        winner ? winner.name : ev.payload.bidder_id,
        ev.payload.amount_cents,
        ev.payload.extended ? '+10s' : undefined
      );

      updateBidHint();
    } else if (ev.event_type === 'auction_closed') {
      auctionStatus = 'closed';
      auctionStatusEl.textContent = 'CLOSED';
      auctionStatusEl.className = 'badge closed';
      btnSubmitBid.disabled = true;

      // Audio gavel triple strike + fanfare
      sounds.playGavelTriple();

      showToast('AUCTION CONCLUDED: LOT HAMMERED DOWN', 'info');
      addFeedItem('closed', ev.seq, 'AUCTION CONCLUDED', ev.payload.final_price_cents);
    } else if (ev.event_type === 'timer_extended') {
      if (ev.payload.ends_at) {
        auctionEndsAt = new Date(ev.payload.ends_at);
      }
      sounds.playAntiSnipingAlert();
      showToast(`ADMIN TIME EXTENSION: +${ev.payload.extension_seconds || 60} SECONDS`, 'extended');
    }
  },

  onEventsReplay: (events) => {
    for (const ev of events) {
      seqCounterEl.textContent = `SEQ #${ev.seq}`;
      if (ev.type === 'bid_accepted') {
        currentPriceCents = Number(ev.payload.current_price_cents);
        currentWinnerId = ev.payload.bidder_id || ev.payload.bidder_name;
        currentWinnerName = ev.payload.bidder_name || ev.payload.bidder_id;
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
      scene.triggerRejectedBidFeedback();
      sounds.playRejected();
      if (result.reject_reason === 'ALREADY_HIGHEST_BIDDER') {
        showToast('YOU ALREADY HOLD THE WINNING BID! Wait for a counter-bid.', 'rejected');
      } else {
        const currentDollars = (result.current_price_cents / 100).toFixed(2);
        showToast(`BID REJECTED: ${result.reject_reason?.toUpperCase()} (Current: $${currentDollars})`, 'rejected');
      }
    } else {
      showToast(`BID SUBMITTED & ACCEPTED: $${(result.amount_cents / 100).toFixed(2)}`, 'info');
    }
  },

  onError: (errMsg) => {
    sounds.playRejected();
    showToast(`ERROR: ${errMsg}`, 'rejected');
  },
});

// 7. Fetch Bidder Tokens from Backend
async function fetchBidderTokens() {
  for (const b of BIDDER_SEATS) {
    try {
      const data = await apiRequest<{ token: string }>(`/auth/token?bidder_id=${b.id}`);
      bidderTokens[b.id] = data.token;
    } catch {
      // offline fallback
    }
  }
}

// 8. Bootstrap Auction Connection
async function bootstrap() {
  renderSeatButtons();
  renderEmptyFeedHint();
  await fetchBidderTokens();

  // Restore stored session if exists
  const storedToken = localStorage.getItem('auction_token');
  if (storedToken) {
    try {
      const meData = await apiRequest<{ user: CurrentUser }>('/auth/me');
      if (meData?.user) {
        currentUser = meData.user;
        const matchedSeat = BIDDER_SEATS[currentUser.seat_index] || BIDDER_SEATS[0];
        activeBidder = matchedSeat;
      }
    } catch {
      // invalid token, use defaults
    }
  }

  updateUserPillUI();
  renderSeatButtons();

  try {
    const data = await apiRequest<{ auctions: any[] }>('/auctions');
    let targetAuction = data.auctions?.find((a: any) => a.status === 'open');

    // If no open auction exists, or it expires in less than 2 minutes, create a fresh live lot
    if (!targetAuction || new Date(targetAuction.ends_at).getTime() - Date.now() < 120000) {
      const createData = await apiRequest<{ auction: any }>('/auctions', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Lot #101: 18th-Century Celestial Orrery',
          starting_price_cents: 5000,
          min_increment_cents: 500,
          ends_at: new Date(Date.now() + 25 * 60 * 1000).toISOString(),
        }),
      });
      targetAuction = createData.auction;
    }

    currentAuctionId = targetAuction.id;
    const initialToken = storedToken || bidderTokens[activeBidder.id];
    network.connect(targetAuction.id, initialToken);
  } catch (err: any) {
    console.error('Failed to bootstrap auction:', err);
    showToast('Failed to connect to backend server', 'rejected');
  }
}

// 9. Form Submission for Bids
async function submitBid() {
  if (isCurrentBidderWinning()) {
    showToast('You already hold the leading bid! Awaiting opponent counter-bids.', 'rejected');
    updateSubmitButtonLabel();
    return;
  }

  const dollars = parseFloat(bidAmountInput.value);
  if (isNaN(dollars) || dollars <= 0) return;

  const cents = Math.round(dollars * 100);
  btnSubmitBid.disabled = true;

  // Sound: wooden paddle raise click
  sounds.playPaddleRaise();

  try {
    const res = await network.placeBid(
      cents,
      activeBidder.name,
      activeBidder.paddleNumber,
      activeBidder.color,
      activeBidder.seatIndex
    );
    if (!res.accepted && res.reject_reason === 'ALREADY_HIGHEST_BIDDER') {
      showToast('You already hold the leading bid! Awaiting opponent counter-bids.', 'rejected');
    }
  } catch (err: any) {
    sounds.playRejected();
    showToast(`BID FAILED: ${err.message}`, 'rejected');
  } finally {
    updateSubmitButtonLabel();
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
    if (isCurrentBidderWinning()) {
      showToast('You already hold the leading bid! Awaiting opponent counter-bids.', 'rejected');
      return;
    }
    const add = parseFloat(btn.getAttribute('data-add') || '0');
    const minThresholdCents = currentPriceCents + minIncrementCents;
    const minValidDollars = minThresholdCents / 100;

    let cur = parseFloat(bidAmountInput.value);
    if (isNaN(cur) || cur < minValidDollars) {
      cur = minValidDollars;
    }
    bidAmountInput.value = (cur + add).toFixed(2);
    updateSubmitButtonLabel();
  });
});

// Camera View Presets
function setActiveViewBtn(btnId: string) {
  document.querySelectorAll('.view-btn-group .view-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById(btnId)?.classList.add('active');
}

document.getElementById('view-saleroom-btn')?.addEventListener('click', () => {
  scene.setCameraView('saleroom');
  setActiveViewBtn('view-saleroom-btn');
});
document.getElementById('view-stage-btn')?.addEventListener('click', () => {
  scene.setCameraView('stage');
  setActiveViewBtn('view-stage-btn');
});
document.getElementById('view-bidders-btn')?.addEventListener('click', () => {
  scene.setCameraView('bidders');
  setActiveViewBtn('view-bidders-btn');
});

// Camera motion toggle
toggleMotionBtn.addEventListener('click', () => {
  const isOrbiting = scene.toggleMotion();
  toggleMotionBtn.textContent = `Motion: ${isOrbiting ? 'Auto' : 'Static'}`;
});

// Sound toggle
toggleSoundBtn.addEventListener('click', () => {
  const isMuted = sounds.toggleMute();
  toggleSoundBtn.textContent = isMuted ? '🔇 Sound: OFF' : '🔊 Sound: ON';
  showToast(isMuted ? 'Audio muted' : 'Audio enabled', 'info');
});

// Chaos drop simulation
chaosTriggerBtn.addEventListener('click', () => {
  network.simulateDrop();
});

// Transaction log panel collapse/expand
const activityPanel = document.getElementById('activity-panel');
const toggleFeedBtn = document.getElementById('toggle-feed-btn');
const openFeedBtn = document.getElementById('open-feed-btn');

toggleFeedBtn?.addEventListener('click', () => {
  activityPanel?.classList.add('collapsed');
  openFeedBtn?.classList.remove('hidden');
});

openFeedBtn?.addEventListener('click', () => {
  activityPanel?.classList.remove('collapsed');
  openFeedBtn?.classList.add('hidden');
});

// 10. User Authentication & Identity Modal
function setupAuthModal() {
  authModalBtn.addEventListener('click', () => {
    renderQuickVipGrid();
    authModalEl.classList.remove('hidden');
  });

  authModalCloseBtn.addEventListener('click', () => {
    authModalEl.classList.add('hidden');
  });

  authModalEl.addEventListener('click', (e) => {
    if (e.target === authModalEl) {
      authModalEl.classList.add('hidden');
    }
  });

  // Modal Tabs
  const tabBtns = [
    { btn: document.getElementById('tab-btn-quick')!, pane: document.getElementById('tab-pane-quick')! },
    { btn: document.getElementById('tab-btn-login')!, pane: document.getElementById('tab-pane-login')!, },
    { btn: document.getElementById('tab-btn-register')!, pane: document.getElementById('tab-pane-register')! },
  ];

  tabBtns.forEach(({ btn, pane }) => {
    btn?.addEventListener('click', () => {
      tabBtns.forEach((t) => {
        t.btn.classList.remove('active');
        t.pane.classList.remove('active');
      });
      btn.classList.add('active');
      pane.classList.add('active');
    });
  });

  // Login Form
  loginFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginFeedbackEl.className = 'form-feedback hidden';

    const identifier = (document.getElementById('login-identifier') as HTMLInputElement).value;
    const password = (document.getElementById('login-password') as HTMLInputElement).value;

    try {
      const res = await apiRequest<{ user: CurrentUser; token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });

      currentUser = res.user;
      localStorage.setItem('auction_token', res.token);
      localStorage.setItem('auction_user', JSON.stringify(res.user));

      network.setToken(res.token);
      if (currentUser.seat_index >= 0 && BIDDER_SEATS[currentUser.seat_index]) {
        selectBidder(BIDDER_SEATS[currentUser.seat_index]);
        scene.focusOnSeat(currentUser.seat_index);
      }
      updateUserPillUI();
      renderSeatButtons();
      renderQuickVipGrid();

      authModalEl.classList.add('hidden');
      showToast(`Welcome back, ${currentUser.username}! Paddle #${currentUser.paddle_number}`, 'info');
    } catch (err: any) {
      loginFeedbackEl.textContent = `Error: ${err.message}`;
      loginFeedbackEl.className = 'form-feedback error';
    }
  });

  // Register Form
  registerFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerFeedbackEl.className = 'form-feedback hidden';

    const username = (document.getElementById('reg-username') as HTMLInputElement).value;
    const email = (document.getElementById('reg-email') as HTMLInputElement).value;
    const password = (document.getElementById('reg-password') as HTMLInputElement).value;
    const paddleNumber = (document.getElementById('reg-paddle') as HTMLInputElement).value;
    const avatarColor = (document.getElementById('reg-color') as HTMLInputElement).value;

    try {
      const newSeatIndex = BIDDER_SEATS.length;
      const res = await apiRequest<{ user: CurrentUser; token: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          username,
          email,
          password,
          paddleNumber,
          avatarColor,
          seatIndex: newSeatIndex,
        }),
      });

      currentUser = res.user;
      currentUser.seat_index = newSeatIndex;
      localStorage.setItem('auction_token', res.token);
      localStorage.setItem('auction_user', JSON.stringify(res.user));

      // Construct and add the new 3D table & articulated bidder!
      const newSeat: BidderSeatConfig = {
        id: res.user.id || `bidder-${newSeatIndex + 1}`,
        name: `${username} (Seat ${newSeatIndex + 1})`,
        color: avatarColor || '#d4af37',
        seatIndex: newSeatIndex,
        paddleNumber: paddleNumber,
        clothingColor: 0x1f2937,
        hairColor: 0x3d2817,
        skinTone: 0xdeb896,
      };

      BIDDER_SEATS.push(newSeat);
      scene.addBidderStation(newSeat);

      network.setToken(res.token);
      selectBidder(newSeat);
      renderSeatButtons();
      renderQuickVipGrid();
      updateUserPillUI();

      // Smoothly pan camera to show the new table!
      scene.focusOnSeat(newSeatIndex);

      authModalEl.classList.add('hidden');
      showToast(`VIP Table #${newSeatIndex + 1} added! Welcome, ${username} (#${paddleNumber})`, 'info');
    } catch (err: any) {
      registerFeedbackEl.textContent = `Error: ${err.message}`;
      registerFeedbackEl.className = 'form-feedback error';
    }
  });
}

// 11. Admin & Curator Deck ("Which item is next" & live controls)
function setupAdminModal() {
  adminDeckBtn.addEventListener('click', async () => {
    adminModalEl.classList.remove('hidden');
    await refreshAdminData();
  });

  adminModalCloseBtn.addEventListener('click', () => {
    adminModalEl.classList.add('hidden');
  });

  adminModalEl.addEventListener('click', (e) => {
    if (e.target === adminModalEl) {
      adminModalEl.classList.add('hidden');
    }
  });

  // Admin Sub-tabs
  const adminTabs = [
    { btn: document.getElementById('admin-tab-stage')!, pane: document.getElementById('admin-pane-stage')! },
    { btn: document.getElementById('admin-tab-catalog')!, pane: document.getElementById('admin-pane-catalog')! },
    { btn: document.getElementById('admin-tab-create')!, pane: document.getElementById('admin-pane-create')! },
    { btn: document.getElementById('admin-tab-telemetry')!, pane: document.getElementById('admin-pane-telemetry')! },
  ];

  adminTabs.forEach(({ btn, pane }) => {
    btn?.addEventListener('click', () => {
      adminTabs.forEach((t) => {
        t.btn.classList.remove('active');
        t.pane.classList.remove('active');
      });
      btn.classList.add('active');
      pane.classList.add('active');
    });
  });

  // 1. Strike Gavel (Attention)
  adminStrikeGavelBtn.addEventListener('click', () => {
    sounds.playGavelStrike(1.2);
    showToast('Gavel strike sounded across saleroom!', 'info');
  });

  // 2. Extend Auction Time (+60s)
  adminExtendTimeBtn.addEventListener('click', async () => {
    if (!currentAuctionId) return;
    try {
      await apiRequest(`/admin/auctions/${currentAuctionId}/extend`, {
        method: 'POST',
        body: JSON.stringify({ seconds: 60 }),
      });
      sounds.playAntiSnipingAlert();
      showToast('Auction extended by 60 seconds', 'extended');
      await refreshAdminData();
    } catch (err: any) {
      showToast(`Extension failed: ${err.message}`, 'rejected');
    }
  });

  // 3. Hammer Down / Conclude Auction
  adminHammerDownBtn.addEventListener('click', async () => {
    if (!currentAuctionId) return;
    if (!confirm('Are you sure you want to conclude bidding and hammer down this lot?')) return;
    try {
      await apiRequest(`/admin/auctions/${currentAuctionId}/close`, {
        method: 'POST',
      });
      sounds.playGavelTriple();
      showToast('Lot hammered down: auction concluded!', 'info');
      await refreshAdminData();
    } catch (err: any) {
      showToast(`Hammer down failed: ${err.message}`, 'rejected');
    }
  });

  // 4. Launch Designated Next Lot to Block
  adminLaunchNextBtn.addEventListener('click', async () => {
    if (!confirm('Launch the designated next lot onto the auction block now?')) return;
    try {
      const res = await apiRequest<{ auction: any; item: any }>('/admin/auctions/launch-next', {
        method: 'POST',
      });

      sounds.playGavelTriple();
      showToast(`Now on the block: Lot #${res.item.lot_number} "${res.item.title}"!`, 'info');

      // Reconnect WebSocket to new auction
      currentAuctionId = res.auction.id;
      network.connect(res.auction.id, localStorage.getItem('auction_token') || undefined);

      await refreshAdminData();
      adminModalEl.classList.add('hidden');
    } catch (err: any) {
      showToast(`Launch failed: ${err.message}`, 'rejected');
    }
  });

  // 5. Create Lot Form
  createLotFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    createLotFeedbackEl.className = 'form-feedback hidden';

    const lotNumber = (document.getElementById('new-lot-number') as HTMLInputElement).value;
    const category = (document.getElementById('new-lot-category') as HTMLSelectElement).value;
    const title = (document.getElementById('new-lot-title') as HTMLInputElement).value;
    const description = (document.getElementById('new-lot-desc') as HTMLTextAreaElement).value;
    const startingDollars = parseFloat((document.getElementById('new-lot-start') as HTMLInputElement).value);
    const incDollars = parseFloat((document.getElementById('new-lot-inc') as HTMLInputElement).value);
    const durationSeconds = parseInt((document.getElementById('new-lot-duration') as HTMLInputElement).value, 10);

    try {
      await apiRequest('/admin/items', {
        method: 'POST',
        body: JSON.stringify({
          lotNumber,
          category,
          title,
          description,
          startingPriceCents: Math.round(startingDollars * 100),
          minIncrementCents: Math.round(incDollars * 100),
          durationSeconds: durationSeconds || 900,
        }),
      });

      createLotFeedbackEl.textContent = `Lot #${lotNumber} "${title}" added to catalog successfully!`;
      createLotFeedbackEl.className = 'form-feedback success';
      createLotFormEl.reset();

      setTimeout(() => {
        document.getElementById('admin-tab-catalog')?.click();
        refreshAdminData();
      }, 1000);
    } catch (err: any) {
      createLotFeedbackEl.textContent = `Error: ${err.message}`;
      createLotFeedbackEl.className = 'form-feedback error';
    }
  });
}

// Refresh all Admin Data (Next Lot, Catalog List, Stats)
async function refreshAdminData() {
  try {
    const [itemsData, statsData] = await Promise.all([
      apiRequest<{ items: any[]; nextItem: any }>('/admin/items'),
      apiRequest<{ totalAuctions: number; totalAcceptedBids: number; registeredUsers: number; activeAuction: any }>('/admin/stats'),
    ]);

    // Live Lot Card
    if (statsData.activeAuction) {
      adminLiveTitleEl.textContent = statsData.activeAuction.title;
      adminLivePriceEl.textContent = `$${(Number(statsData.activeAuction.current_price_cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      adminLiveIncrementEl.textContent = `+$${(Number(statsData.activeAuction.min_increment_cents) / 100).toFixed(2)}`;
    } else {
      adminLiveTitleEl.textContent = 'No auction currently open';
      adminLivePriceEl.textContent = '$0.00';
    }

    // Next Lot Card
    const nextItem = itemsData.nextItem;
    if (nextItem) {
      adminNextTitleEl.textContent = `Lot #${nextItem.lot_number}: ${nextItem.title}`;
      adminNextDescEl.textContent = nextItem.description;
      adminNextEstimateEl.textContent = `$${(Number(nextItem.estimated_price_cents || 0) / 100).toLocaleString('en-US')}`;
      adminNextStartEl.textContent = `$${(Number(nextItem.starting_price_cents || 0) / 100).toLocaleString('en-US')}`;
      adminLaunchNextBtn.disabled = false;
    } else {
      adminNextTitleEl.textContent = 'No item designated as Next Up';
      adminNextDescEl.textContent = 'Select an item from the catalog queue to cue it.';
      adminLaunchNextBtn.disabled = true;
    }

    // Catalog List
    adminCatalogListEl.innerHTML = '';
    for (const item of itemsData.items) {
      const card = document.createElement('div');
      card.className = `catalog-item-card ${item.is_next ? 'is-next' : ''} ${item.status === 'live' ? 'is-live' : ''}`;

      const formattedStart = `$${(Number(item.starting_price_cents) / 100).toLocaleString('en-US')}`;

      card.innerHTML = `
        <div class="cat-item-left">
          <div class="cat-item-title-row">
            <span class="cat-lot-num">LOT #${item.lot_number}</span>
            <span class="cat-item-title">${item.title}</span>
          </div>
          <div class="cat-item-meta">${item.category} • Opening Ask: ${formattedStart}</div>
        </div>
        <div class="cat-item-right">
          ${item.is_next ? '<span class="cat-badge next">✨ NEXT UP</span>' : ''}
          ${item.status === 'live' ? '<span class="cat-badge live">● LIVE NOW</span>' : ''}
          ${item.status === 'completed' ? '<span class="cat-badge">SOLD</span>' : ''}
          ${!item.is_next && item.status !== 'live'
          ? `<button class="cat-action-btn set-next-btn" data-id="${item.id}">⭐ Set as Next</button>`
          : ''
        }
          ${item.status !== 'live'
          ? `<button class="cat-action-btn launch-btn" data-id="${item.id}">🚀 Launch</button>`
          : ''
        }
        </div>
      `;

      // Set as Next button listener
      card.querySelector('.set-next-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await apiRequest(`/admin/items/${item.id}/next`, { method: 'POST' });
          showToast(`Lot #${item.lot_number} is now designated as NEXT on the block!`, 'info');
          await refreshAdminData();
        } catch (err: any) {
          showToast(`Failed: ${err.message}`, 'rejected');
        }
      });

      // Launch immediately button listener
      card.querySelector('.launch-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Launch Lot #${item.lot_number} "${item.title}" to the auction block now?`)) return;
        try {
          const res = await apiRequest<{ auction: any; item: any }>('/admin/auctions/launch-next', {
            method: 'POST',
            body: JSON.stringify({ item_id: item.id }),
          });
          sounds.playGavelTriple();
          showToast(`Lot #${item.lot_number} launched live!`, 'info');
          currentAuctionId = res.auction.id;
          network.connect(res.auction.id, localStorage.getItem('auction_token') || undefined);
          await refreshAdminData();
          adminModalEl.classList.add('hidden');
        } catch (err: any) {
          showToast(`Failed: ${err.message}`, 'rejected');
        }
      });

      adminCatalogListEl.appendChild(card);
    }

    // Telemetry
    teleTotalAuctionsEl.textContent = statsData.totalAuctions.toString();
    teleAcceptedBidsEl.textContent = statsData.totalAcceptedBids.toString();
    teleBiddersCountEl.textContent = statsData.registeredUsers.toString();
  } catch (err) {
    console.warn('Failed to refresh admin data:', err);
  }
}

// 12. Animation Loop
let lastFrameTime = performance.now();

function updateCountdown() {
  if (!auctionEndsAt) return;
  const now = Date.now();
  const diff = Math.max(0, auctionEndsAt.getTime() - now);

  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  if (auctionTimerBadgeEl) {
    auctionTimerBadgeEl.textContent = `⏱️ ${timeStr}`;
    if (diff <= 10000 && diff > 0 && auctionStatus === 'open') {
      auctionTimerBadgeEl.className = 'badge timer-badge urgent';
    } else {
      auctionTimerBadgeEl.className = 'badge timer-badge';
    }
  }
  scene.setCountdown(diff, 90 * 1000); // 90-second scale

  // Automatic hammer down when timer hits 0
  if (diff <= 0 && auctionStatus === 'open') {
    auctionStatus = 'closed';
    auctionStatusEl.textContent = 'HAMMER DOWN';
    auctionStatusEl.className = 'badge closed';
    if (auctionTimerBadgeEl) {
      auctionTimerBadgeEl.textContent = '⏱️ 00:00';
      auctionTimerBadgeEl.className = 'badge timer-badge';
    }
    btnSubmitBid.disabled = true;
    sounds.playGavelTriple();
    showToast('AUCTION CONCLUDED: LOT HAMMERED DOWN!', 'info');
    updateSubmitButtonLabel();
  }
}

function animate(now: number) {
  requestAnimationFrame(animate);
  const delta = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  scene.render(delta);
  updateCountdown();
}

// 13. Setup Server / Engine Modal
function setupServerModal() {
  function updateModalStatus() {
    const isSim = network.isSimulating || isSimulationMode();
    if (isSim) {
      serverStatusIndicatorEl.textContent = '✨';
      serverStatusModeTitleEl.textContent = 'Saleroom Interactive Standalone Engine';
      serverStatusModeDescEl.textContent =
        'Running in zero-latency client simulation mode. Full 3D room, articulated bidders, mechanical odometer, sound synthesis, and Curator Deck are fully operational.';
    } else {
      const currentHost = getApiBaseUrl() || window.location.origin;
      serverStatusIndicatorEl.textContent = '⚡';
      serverStatusModeTitleEl.textContent = 'Live AWS WebSocket & PostgreSQL Backend';
      serverStatusModeDescEl.textContent = `Connected to live backend host: ${currentHost}. Multi-client synchronization and persistent database active.`;
    }

    customServerInput.value = getCustomServerUrl();
    toggleAiBiddersBtn.textContent = simulationEngine.aiBiddingEnabled
      ? 'Floor Bidders: ACTIVE'
      : 'Floor Bidders: PAUSED';
    toggleAiBiddersBtn.className = simulationEngine.aiBiddingEnabled
      ? 'ctrl-btn view-btn active'
      : 'ctrl-btn view-btn';
  }

  function openServerModal() {
    updateModalStatus();
    serverTestFeedbackEl.className = 'form-feedback hidden';
    serverModalEl.classList.remove('hidden');
  }

  serverSettingsBtn?.addEventListener('click', openServerModal);
  connectionPillEl?.addEventListener('click', openServerModal);

  serverModalCloseBtn?.addEventListener('click', () => {
    serverModalEl.classList.add('hidden');
  });

  serverModalEl?.addEventListener('click', (e) => {
    if (e.target === serverModalEl) {
      serverModalEl.classList.add('hidden');
    }
  });

  // Test Server Button
  testServerBtn?.addEventListener('click', async () => {
    const targetUrl = customServerInput.value.trim().replace(/\/+$/, '');
    if (!targetUrl) {
      serverTestFeedbackEl.textContent = 'Please enter a server URL to test (e.g. http://<EC2-IP>:3000)';
      serverTestFeedbackEl.className = 'form-feedback error';
      return;
    }

    serverTestFeedbackEl.textContent = 'Pinging backend health endpoint...';
    serverTestFeedbackEl.className = 'form-feedback';

    try {
      const res = await fetch(`${targetUrl}/health`);
      if (res.ok) {
        const data = await res.json();
        serverTestFeedbackEl.textContent = `Success! Backend online (Status: ${data.status || 'ok'}).`;
        serverTestFeedbackEl.className = 'form-feedback success';
      } else {
        serverTestFeedbackEl.textContent = `Server responded with HTTP ${res.status}: ${res.statusText}`;
        serverTestFeedbackEl.className = 'form-feedback error';
      }
    } catch (err: any) {
      serverTestFeedbackEl.textContent = `Connection failed: ${err.message}. Make sure CORS and Port 3000 are open.`;
      serverTestFeedbackEl.className = 'form-feedback error';
    }
  });

  // Save Server Button
  saveServerBtn?.addEventListener('click', async () => {
    const val = customServerInput.value.trim();
    if (val) {
      setCustomServerUrl(val);
      showToast(`Custom backend configured: ${val}`, 'info');
    } else {
      setCustomServerUrl(null);
      setForcedDemoMode(true);
      showToast('Switched to Standalone Saleroom Demo', 'info');
    }
    serverModalEl.classList.add('hidden');
    await bootstrap();
  });

  // Reset to Demo Button
  resetDemoBtn?.addEventListener('click', async () => {
    setCustomServerUrl(null);
    setForcedDemoMode(true);
    customServerInput.value = '';
    showToast('Activated Zero-Latency Standalone Saleroom', 'info');
    serverModalEl.classList.add('hidden');
    await bootstrap();
  });

  // Toggle AI Bidders Button
  toggleAiBiddersBtn?.addEventListener('click', () => {
    simulationEngine.aiBiddingEnabled = !simulationEngine.aiBiddingEnabled;
    updateModalStatus();
    showToast(
      simulationEngine.aiBiddingEnabled ? 'AI Floor Bidders activated' : 'AI Floor Bidders paused',
      'info'
    );
  });
}

// Initialize setup
setupAuthModal();
setupAdminModal();
setupServerModal();
requestAnimationFrame(animate);
bootstrap();
