const { ethers, Wallet, WebSocketProvider, Contract, Interface } = require('ethers');
require('dotenv').config();

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    WSS_URL: process.env.WSS_URL,
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    WETH_USDC_POOL: "0x88A43bb75941904d47401946215162a26bc773dc",
    GAS_ORACLE: "0x420000000000000000000000000000000000000F", // Base L1 Oracle
    GAS_LIMIT: 980000n,
    MARGIN_ETH: process.env.MARGIN_ETH || "0.015" // Buffering for L1 fees
};

// ABIs
const ORACLE_ABI = ["function getL1Fee(bytes memory _data) public view returns (uint256)"];
const PAIR_ABI = ["function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"];
const TITAN_ABI = ["function requestTitanLoan(address,uint256,address[])"];

async function startWhaleStriker() {
    console.log(`\n🔱 APEX TITAN: LIQUIDITY GUARD & L1-PROTECTION ACTIVE`);
    
    const provider = new WebSocketProvider(CONFIG.WSS_URL);
    const signer = new Wallet(process.env.TREASURY_PRIVATE_KEY, provider);
    const poolContract = new Contract(CONFIG.WETH_USDC_POOL, PAIR_ABI, provider);
    const oracleContract = new Contract(CONFIG.GAS_ORACLE, ORACLE_ABI, provider);
    const titanIface = new Interface(TITAN_ABI);

    provider.on({ address: CONFIG.WETH_USDC_POOL }, async (log) => {
        try {
            // 1. LIQUIDITY GUARD: Check reserves to scale loan
            const [reserve0, reserve1] = await poolContract.getReserves();
            // On Base WETH/USDC, WETH is usually reserve0. We use 10% of pool max.
            const maxSafeLoan = reserve0 / 10n; 

            // 2. ENCODE STRIKE
            const strikeData = titanIface.encodeFunctionData("requestTitanLoan", [
                CONFIG.WETH, maxSafeLoan, [CONFIG.WETH, CONFIG.USDC]
            ]);

            // 3. SIMULATE GROSS PROFIT
            const simulation = await provider.call({
                to: CONFIG.TARGET_CONTRACT,
                data: strikeData,
                from: signer.address
            });
            const grossProfit = BigInt(simulation);

            // 4. CALCULATE TOTAL COST (L1 Data Fee + L2 Gas + Aave 0.05%)
            const feeData = await provider.getFeeData();
            const l2Cost = CONFIG.GAS_LIMIT * (feeData.maxFeePerGas || feeData.gasPrice);
            const l1Fee = await oracleContract.getL1Fee(strikeData);
            const aaveFee = (maxSafeLoan * 5n) / 10000n;
            
            const totalCosts = l2Cost + l1Fee + aaveFee;
            const netProfit = grossProfit - totalCosts;

            // 5. STRIKE DECISION
            if (netProfit > ethers.parseEther(CONFIG.MARGIN_ETH)) {
                console.log(`💎 PROFIT: ${ethers.formatEther(netProfit)} ETH (Net)`);
                const tx = await signer.sendTransaction({
                    to: CONFIG.TARGET_CONTRACT,
                    data: strikeData,
                    gasLimit: CONFIG.GAS_LIMIT,
                    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
                    maxFeePerGas: feeData.maxFeePerGas,
                    type: 2
                });
                console.log(`🚀 FIRED: ${tx.hash}`);
            }
        } catch (e) {
            // Trades often fail simulation if someone else beats you; ignore and continue.
        }
    });

    provider.websocket.on("close", () => {
        console.log("⚠️ Connection lost. Reconnecting...");
        setTimeout(startWhaleStriker, 5000);
    });
}

// Ensure the boot error is fixed with proper closing tags
startWhaleStriker().catch((err) => {
    console.error("❌ BOOT ERROR:", err.message);
});
