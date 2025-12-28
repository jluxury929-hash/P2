const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, Interface } = require('ethers');
require('dotenv').config();

// --- 1. CONFIGURATION & ADDRESSES ---
const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_URL: process.env.WSS_URL,
    RPC_URL: "https://mainnet.base.org",
    
    // Core Infrastructure
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_ETH_USD: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", // Base Mainnet
    
    // Arbitrage Assets
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH_USDC_POOL: "0x88A43bb75941904d47401946215162a26bc773dc",
    
    // Performance Parameters
    GAS_LIMIT: 1200000n, // Increased to ensure complex loops don't fail
    PRIORITY_BRIBE: 12n,  // 12% extra tip to beat other bots
    MARGIN_ETH: process.env.MARGIN_ETH || "0.015"
};

// --- 2. THE ENGINE ---
async function startOmniscientTitan() {
    console.log("-----------------------------------------");
    console.log("🌑 OMNISCIENT TITAN INITIALIZING...");

    // A. KEY SANITIZER (The Error Fix)
    const rawKey = process.env.TREASURY_PRIVATE_KEY;
    if (!rawKey) { console.error("❌ ERROR: Key missing from .env"); process.exit(1); }
    const cleanKey = rawKey.trim();

    try {
        // B. DUAL-PROVIDER SETUP (First for speed, HTTP for safety)
        const httpProvider = new JsonRpcProvider(CONFIG.RPC_URL);
        const wsProvider = new WebSocketProvider(CONFIG.WSS_URL);
        const signer = new Wallet(cleanKey, httpProvider);
        await wsProvider.ready;

        // C. ORACLE & INTERFACE SETUP
        const pool = new Contract(CONFIG.WETH_USDC_POOL, ["function getReserves() external view returns (uint112, uint112, uint32)"], httpProvider);
        const ethPriceFeed = new Contract(CONFIG.CHAINLINK_ETH_USD, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], httpProvider);
        const oracle = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes memory) public view returns (uint256)"], httpProvider);
        const titanIface = new Interface(["function requestTitanLoan(address,uint256,address[])"]);

        let isScanning = false;
        console.log(`✅ SIGNER: ${signer.address} | BASE MAINNET`);

        // D. THE "FIRST-TO-KNOW" LISTENER
        wsProvider.on("block", async (blockNumber) => {
            if (isScanning) return;
            isScanning = true;

            try {
                // 1. GET REAL-TIME ETH PRICE (EVERY BLOCK)
                const [, priceData] = await ethPriceFeed.latestRoundData();
                const ethPrice = (Number(priceData) / 1e8).toFixed(2);
                
                process.stdout.write(`\r⛓️ BLOCK: ${blockNumber} | ETH: $${ethPrice} | TITAN: Ready `);

                // 2. FETCH POOL LIQUIDITY
                const [res0] = await pool.getReserves();
                const loan = res0 / 8n; // Use 12.5% of pool for impact

                const data = titanIface.encodeFunctionData("requestTitanLoan", [CONFIG.WETH, loan, [CONFIG.WETH, CONFIG.USDC]]);

                // 3. AGGRESSIVE SIMULATION & GAS
                const [simulation, l1Fee, feeData] = await Promise.all([
                    httpProvider.call({ to: CONFIG.TARGET_CONTRACT, data, from: signer.address }).catch(() => null),
                    oracle.getL1Fee(data),
                    httpProvider.getFeeData()
                ]);

                if (!simulation) {
                    isScanning = false;
                    return;
                }

                // 4. PROFIT VS COST CALCULATION (Including Bribe)
                const aggressivePriority = (feeData.maxPriorityFeePerGas * (100n + CONFIG.PRIORITY_BRIBE)) / 100n;
                const totalCost = (CONFIG.GAS_LIMIT * feeData.maxFeePerGas) + l1Fee;
                const netProfit = BigInt(simulation) - totalCost;

                if (netProfit > ethers.parseEther(CONFIG.MARGIN_ETH)) {
                    console.log(`\n💎 PROFIT DETECTED: ${ethers.formatEther(netProfit)} ETH ($${(Number(ethers.formatEther(netProfit)) * Number(ethPrice)).toFixed(2)})`);
                    
                    const tx = await signer.sendTransaction({
                        to: CONFIG.TARGET_CONTRACT,
                        data,
                        gasLimit: CONFIG.GAS_LIMIT,
                        maxFeePerGas: feeData.maxFeePerGas,
                        maxPriorityFeePerGas: aggressivePriority,
                        type: 2
                    });

                    console.log(`🚀 STRIKE FIRED: ${tx.hash}`);
                }
            } catch (err) {
                // Silent catch for standard reverts
            } finally {
                isScanning = false;
            }
        });

        // E. AUTO-RECOVERY (If WebSocket Dips)
        wsProvider.websocket.onclose = () => {
            console.warn("\n📡 DISCONNECTED. REBOOTING...");
            process.exit(1); 
        };

    } catch (err) {
        console.error("❌ STARTUP ERROR:", err.message);
        setTimeout(startOmniscientTitan, 2000);
    }
}

startOmniscientTitan();
