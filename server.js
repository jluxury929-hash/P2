const { ethers, Wallet, WebSocketProvider, Contract, Interface } = require('ethers');
require('dotenv').config();

// 1. BOOTSTRAP CHECK
console.log("-----------------------------------------");
console.log("🟢 [DEBUG] SCRIPT INITIALIZING...");

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_URL: process.env.WSS_URL,
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH_USDC_POOL: "0x88A43bb75941904d47401946215162a26bc773dc",
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    GAS_LIMIT: 980000n,
    MARGIN_ETH: process.env.MARGIN_ETH || "0.015"
};

async function startTitan() {
    // 2. URL VALIDATION
    if (!CONFIG.WSS_URL || !CONFIG.WSS_URL.startsWith('wss://')) {
        console.error("❌ CRITICAL: WSS_URL is missing or invalid in .env");
        process.exit(1);
    }

    console.log(`📡 CONNECTING TO BASE: ${CONFIG.WSS_URL.substring(0, 35)}...`);
    
    try {
        const provider = new WebSocketProvider(CONFIG.WSS_URL);
        const signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
        
        // --- POOL AND ORACLE SETUP ---
        const pool = new Contract(CONFIG.WETH_USDC_POOL, ["function getReserves() external view returns (uint112, uint112, uint32)"], provider);
        const oracle = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes memory) public view returns (uint256)"], provider);
        const titanIface = new Interface(["function requestTitanLoan(address,uint256,address[])"]);

        // 3. HEARTBEAT LOG (New Blocks)
        provider.on("block", (num) => {
            console.log(`⛓️ BLOCK: ${num} | Titan is listening...`);
        });

        console.log(`🔱 TITAN v38.9.26 ONLINE | SIGNER: ${signer.address}`);

        // 4. EVENT LISTENER
        provider.on({ address: CONFIG.WETH_USDC_POOL }, async (log) => {
            console.log("🔔 POOL ACTIVITY DETECTED - SIMULATING...");
            try {
                const [res0] = await pool.getReserves();
                const loan = res0 / 10n; // Use 10% of pool liquidity
                
                const data = titanIface.encodeFunctionData("requestTitanLoan", [CONFIG.WETH, loan, [CONFIG.WETH, CONFIG.USDC]]);
                
                // Simulation + L1 Fee Calc
                const [grossProfit, l1Fee, feeData] = await Promise.all([
                    provider.call({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }),
                    oracle.getL1Fee(data),
                    provider.getFeeData()
                ]);

                const totalCost = (CONFIG.GAS_LIMIT * feeData.gasPrice) + l1Fee;
                const netProfit = BigInt(grossProfit) - totalCost;

                if (netProfit > ethers.parseEther(CONFIG.MARGIN_ETH)) {
                    console.log(`💎 PROFITABLE: ${ethers.formatEther(netProfit)} ETH`);
                    const tx = await signer.sendTransaction({ to: CONFIG.TARGET_CONTRACT, data, gasLimit: CONFIG.GAS_LIMIT });
                    console.log(`🚀 STRIKE SUCCESS: ${tx.hash}`);
                }
            } catch (e) {
                // Log errors only if they aren't standard simulation reverts
                if (!e.message.includes("revert")) console.log("⚠️ Simulation error:", e.message);
            }
        });

        // 5. RECONNECTION LOGIC
        provider.websocket.on("close", () => {
            console.warn("⚠️ WebSocket Disconnected. Retrying in 5s...");
            setTimeout(startTitan, 5000);
        });

    } catch (err) {
        console.error("❌ STARTUP ERROR:", err.message);
        setTimeout(startTitan, 5000);
    }
}

// EXECUTE
startTitan();
