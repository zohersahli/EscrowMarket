// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract EscrowMarket {
    error NotAdmin();
    error NotSeller(uint256 id);
    error NotBuyer(uint256 id);
    error WrongState(uint8 expected, uint8 got);
    error ZeroValue();
    error BadPrice();
    error InvalidDeal(uint256 id);
    error NotParticipant(uint256 id);
    error SelfPurchaseNotAllowed(uint256 id);
    error InvalidStateForDispute(uint8 got);
    error NothingToWithdraw();
    error SendFailed();
    error DirectPaymentRejected();
    error Paused();
    error DealFrozen(uint256 id);
    error Banned(address account);

    enum DealState { Listed, Funded, Shipped, Completed, Cancelled, Disputed }

    struct Deal {
        uint256 id;
        address seller;
        address buyer;
        uint128 price;
        uint64 createdAt;
        DealState state;
        string title;
    }

    address public immutable admin;
    uint256 public nextId;
    mapping(uint256 => Deal) public deals;
    mapping(address => uint256) public balances;

    bool public paused;
    mapping(uint256 => bool) public frozen;
    mapping(address => bool) public banned;

    event DealListed(
        uint256 indexed id,
        address indexed seller,
        uint128 price,
        string title
    );
    event DealTitleUpdated(uint256 indexed id, string title);
    event DealFunded(uint256 indexed id, address indexed buyer, uint128 amount);
    event DealShipped(uint256 indexed id);
    event DealCompleted(uint256 indexed id);
    event DealCancelled(uint256 indexed id);
    event DealDisputed(uint256 indexed id);
    event DealResolved(uint256 indexed id, bool releasedToSeller);
    event Withdrawal(address indexed account, uint256 amount);
    event DealDelisted(uint256 indexed id);
    event PausedSet(bool paused);
    event DealFrozenSet(uint256 indexed id, bool frozen);
    event BannedSet(address indexed account, bool banned);

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlySeller(uint256 id) {
        Deal storage d = deals[id];
        if (d.seller == address(0)) revert InvalidDeal(id);
        if (msg.sender != d.seller) revert NotSeller(id);
        _;
    }

    modifier onlyBuyer(uint256 id) {
        Deal storage d = deals[id];
        if (d.seller == address(0)) revert InvalidDeal(id);
        if (msg.sender != d.buyer) revert NotBuyer(id);
        _;
    }

    modifier inState(uint256 id, DealState expected) {
        Deal storage d = deals[id];
        if (d.seller == address(0)) revert InvalidDeal(id);
        if (d.state != expected) revert WrongState(uint8(expected), uint8(d.state));
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier notFrozen(uint256 id) {
        if (frozen[id]) revert DealFrozen(id);
        _;
    }

    modifier notBannedForNewDeals() {
        if (banned[msg.sender]) revert Banned(msg.sender);
        _;
    }
    // --- Admin controls --- //Pausning, frysning och förbud
    function pause() external onlyAdmin { paused = true; emit PausedSet(true); }
    function unpause() external onlyAdmin { paused = false; emit PausedSet(false); }
    function freeze(uint256 id) external onlyAdmin {
        if (deals[id].seller == address(0)) revert InvalidDeal(id);
        frozen[id] = true; 
        emit DealFrozenSet(id, true);
    }
    function unfreeze(uint256 id) external onlyAdmin {
        if (deals[id].seller == address(0)) revert InvalidDeal(id);
        frozen[id] = false; 
        emit DealFrozenSet(id, false);
    }
    function setBanned(address account, bool isBanned) external onlyAdmin {
        banned[account] = isBanned; emit BannedSet(account, isBanned);
    }
        // --- Admin controls --- //Pausning, frysning och förbud  ---end---

    function list(
        uint128 price,
        string calldata title
    ) external whenNotPaused notBannedForNewDeals returns (uint256 id) {
        if (price == 0) revert ZeroValue();
        unchecked { 
            id = ++nextId;
        }
        deals[id] = Deal({
            id:        id,
            seller:    msg.sender,
            buyer:     address(0),
            price:     price,
            createdAt: uint64(block.timestamp),
            state:     DealState.Listed,
            title:     title
        });
        emit DealListed(id, msg.sender, price, title);
    }

    function updateTitle(
        uint256 id,
        string calldata title
    )
        external
        whenNotPaused
        notFrozen(id)
        onlySeller(id)
        inState(id, DealState.Listed)
    {
        Deal storage d = deals[id];
        d.title = title;
        emit DealTitleUpdated(id, title);
    }

    function fund(uint256 id)
        external
        payable
        whenNotPaused
        notBannedForNewDeals
        notFrozen(id)
        inState(id, DealState.Listed)
    {
        Deal storage d = deals[id];
        if (msg.sender == d.seller) revert SelfPurchaseNotAllowed(id);
        uint128 price = d.price;
        if (msg.value != uint256(price)) revert BadPrice();
        d.buyer = msg.sender;
        d.state = DealState.Funded;
        emit DealFunded(id, msg.sender, price);
    }

    function ship(uint256 id)
        external
        whenNotPaused
        notFrozen(id)
        onlySeller(id)
        inState(id, DealState.Funded)
    {
        Deal storage d = deals[id];
        d.state = DealState.Shipped;
        emit DealShipped(id);
    }

    function confirmReceived(uint256 id)
        external
        whenNotPaused
        notFrozen(id)
        onlyBuyer(id)
        inState(id, DealState.Shipped)
    {
        Deal storage d = deals[id];
        balances[d.seller] += uint256(d.price);
        d.state = DealState.Completed;
        assert(d.state == DealState.Completed);
        emit DealCompleted(id);
    }

    function cancelBeforeShipment(uint256 id)
        external
        whenNotPaused
        notFrozen(id)
        onlyBuyer(id)
        inState(id, DealState.Funded)
    {
        Deal storage d = deals[id];
        balances[d.buyer] += uint256(d.price);
        d.state = DealState.Cancelled;
        emit DealCancelled(id);
    }

    function deleteList(uint256 id)
        external
        whenNotPaused
        notFrozen(id)
        onlySeller(id)
        inState(id, DealState.Listed)
    {
        delete deals[id];
        emit DealDelisted(id);
    }

    function openDispute(uint256 id) external whenNotPaused {
        Deal storage d = deals[id];
        if (d.seller == address(0)) revert InvalidDeal(id);
        if (msg.sender != d.seller && msg.sender != d.buyer) {
            revert NotParticipant(id);
        }
        if (d.state != DealState.Funded && d.state != DealState.Shipped) {
            revert InvalidStateForDispute(uint8(d.state));
        }
        d.state = DealState.Disputed;
        emit DealDisputed(id);
    }

    function resolveDispute(uint256 id, bool releaseToSeller)
        external
        onlyAdmin
        inState(id, DealState.Disputed)
    {
        Deal storage d = deals[id];
        if (releaseToSeller) {
            balances[d.seller] += uint256(d.price);
            d.state = DealState.Completed;
        } else {
            balances[d.buyer] += uint256(d.price);
            d.state = DealState.Cancelled;
        }
        emit DealResolved(id, releaseToSeller);
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        require(address(this).balance >= amount);
        balances[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert SendFailed();
        emit Withdrawal(msg.sender, amount);
    }

    receive() external payable {
        revert DirectPaymentRejected();
    }

    fallback() external payable {
        revert DirectPaymentRejected();
    }
}
