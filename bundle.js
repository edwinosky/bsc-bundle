import { ethers } from 'ethers';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// --- Configuración Inicial y Carga de Variables de Entorno ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

console.log('--- Cargando Configuración ---');

const config = {
    rescueWalletAddress: process.env.RESCUE_WALLET_ADDRESS,
    hackedWalletAddress: process.env.HACKED_WALLET_ADDRESS,
    treasuryWalletAddress: process.env.TREASURY_WALLET_ADDRESS,
    rescuePrivateKey: process.env.RESCUE_PRIVATE_KEY,
    hackedPrivateKey: process.env.HACKED_PRIVATE_KEY,
    tokenContractAddress: process.env.TOKEN_CONTRACT_ADDRESS,
    bloxrouteAuthHeader: process.env.BLOXROUTE_AUTH_HEADER,
    bloxrouteFeeRecipient: process.env.BLOXROUTE_FEE_RECIPIENT,
    bscRpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
    priorityFeeGwei: BigInt(process.env.PRIORITY_FEE_GWEI || '5'),
    initialBnbWei: BigInt(process.env.INITIAL_BNB_WEI || '3500000000000000'),
    dynamicFeeWei: BigInt(process.env.DYNAMIC_FEE_WEI || '1000000000000000'),
    chainId: 56n,
    commissionPercent: 20n,
    gasLimitBnbTx: 21000n,
    gasLimitTokenTxFallback: 200000n,
    gasEstimateMargin: 120n
};

// Validar configuración esencial
const requiredConfigKeys = [
    'rescueWalletAddress', 'hackedWalletAddress', 'treasuryWalletAddress',
    'rescuePrivateKey', 'hackedPrivateKey', 'tokenContractAddress',
    'bloxrouteAuthHeader', 'bloxrouteFeeRecipient'
];
for (const key of requiredConfigKeys) {
    if (!config[key]) {
        console.error(`Error Fatal: Falta la variable de entorno requerida: ${key.replace(/([A-Z])/g, '_$1').toUpperCase()}. Revisa tu archivo .env`);
        process.exit(1);
    }
}

const erc20Abi = [
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "function decimals() view returns (uint8)"
];

async function runRescueScript() {
    console.log("\n--- Iniciando Script de Rescate Autónomo con BloxRoute ---");
    console.log(`   Rescatando Token: ${config.tokenContractAddress}`);
    console.log(`   Desde Wallet Comprometida: ${config.hackedWalletAddress}`);
    console.log(`   Hacia Wallet Segura: ${config.rescueWalletAddress}`);

    const provider = new ethers.JsonRpcProvider(config.bscRpcUrl);
    try {
        const network = await provider.getNetwork();
        if (network.chainId !== config.chainId) {
            console.warn(`ADVERTENCIA: Conectado a Chain ID ${network.chainId}, pero se esperaba ${config.chainId}.`);
        } else {
            console.log(`Conectado a RPC: ${config.bscRpcUrl}, Chain ID: ${network.chainId}`);
        }
    } catch (error) {
        console.error(`Error Fatal: No se pudo conectar al nodo RPC: ${config.bscRpcUrl}`, error);
        process.exit(1);
    }

    const rescueWallet = new ethers.Wallet(config.rescuePrivateKey, provider);
    const hackedWallet = new ethers.Wallet(config.hackedPrivateKey, provider);

    if (rescueWallet.address !== config.rescueWalletAddress || hackedWallet.address !== config.hackedWalletAddress) {
         console.error("¡Error! Las claves privadas en .env no corresponden a las direcciones.");
         process.exit(1);
    }
    console.log(`Wallet Rescate (Firma Tx1,3,5): ${rescueWallet.address}`);
    console.log(`Wallet Hackeada (Firma Tx2,4): ${hackedWallet.address}`);
    console.log(`Wallet Tesorería (Recibe Comisión): ${config.treasuryWalletAddress}`);

    const tokenContract = new ethers.Contract(config.tokenContractAddress, erc20Abi, provider);
    let tokenDecimals = 18n;
    try {
        tokenDecimals = BigInt(await tokenContract.decimals());
    } catch (e) { console.warn("No se pudieron obtener decimales del token, usando 18 por defecto."); }

    try {
        console.log("\nObteniendo nonces y datos de tarifa...");
        const [rescueNonce, hackedNonce, feeData] = await Promise.all([
            provider.getTransactionCount(rescueWallet.address, 'latest'),
            provider.getTransactionCount(hackedWallet.address, 'latest'),
            provider.getFeeData()
        ]);

        if (feeData.gasPrice === null) throw new Error("No se pudo obtener gasPrice.");
        const baseGasPrice = feeData.gasPrice;
        const priorityFee = ethers.parseUnits(config.priorityFeeGwei.toString(), 'gwei');
        const effectiveGasPrice = baseGasPrice + priorityFee;

        console.log(`   Nonce Rescate: ${rescueNonce}, Nonce Hackeada: ${hackedNonce}`);
        console.log(`   Precio Gas Efectivo: ${ethers.formatUnits(effectiveGasPrice, 'gwei')} gwei`);

        console.log("\nObteniendo balance de tokens...");
        const tokenBalance = await tokenContract.balanceOf(config.hackedWalletAddress);
        const tokenBalanceFormatted = ethers.formatUnits(tokenBalance, tokenDecimals);
        console.log(`   Balance encontrado: ${tokenBalance.toString()} (unidades mínimas) / ${tokenBalanceFormatted}`);

        if (tokenBalance === 0n) {
            throw new Error(`Balance del token ${config.tokenContractAddress} es cero en ${config.hackedWalletAddress}.`);
        }

        const commissionAmount = (tokenBalance * config.commissionPercent) / 100n;
        console.log(`   Comisión calculada (20%): ${ethers.formatUnits(commissionAmount, tokenDecimals)} tokens`);

        const signedTxsHex = [];
        let gasLimitTokenTx2 = config.gasLimitTokenTxFallback;

        // --- 1. Tx1: Enviar BNB inicial (Rescue -> Hacked) ---
        console.log(`\n1. Creando Tx1: Enviar ${ethers.formatUnits(config.initialBnbWei, 'ether')} BNB a Hacked (Nonce: ${rescueNonce})`);
        const tx1 = { /* ... tx params ... */
             to: config.hackedWalletAddress, value: config.initialBnbWei, gasLimit: config.gasLimitBnbTx,
             gasPrice: effectiveGasPrice, nonce: rescueNonce, chainId: config.chainId };
        const signedTx1 = await rescueWallet.signTransaction(tx1);
        signedTxsHex.push(signedTx1.replace('0x', ''));
        console.log("   Tx1 Firmada.");

        // --- 2. Tx2: Transferir Tokens (Hacked -> Rescue) ---
        console.log(`\n2. Creando Tx2: Transferir ${tokenBalanceFormatted} tokens a Rescue (Nonce: ${hackedNonce})`);
        try {
            const connectedTokenContractHacked = tokenContract.connect(hackedWallet);
            const estimatedGas = await connectedTokenContractHacked.transfer.estimateGas(config.rescueWalletAddress, tokenBalance);
            gasLimitTokenTx2 = (estimatedGas * config.gasEstimateMargin) / 100n;
            console.log(`   Gas estimado Tx2: ${estimatedGas.toString()}, usando límite: ${gasLimitTokenTx2.toString()}`);
        } catch (estimateError) {
            console.warn(`   Advertencia: Falló estimación gas Tx2 (${estimateError.message}). Usando límite fijo: ${gasLimitTokenTx2.toString()}`);
             gasLimitTokenTx2 = config.gasLimitTokenTxFallback; // Asegurar fallback si estimación falla
        }
        const tx2Data = tokenContract.interface.encodeFunctionData("transfer", [config.rescueWalletAddress, tokenBalance]);
        const tx2 = { /* ... tx params ... */
             to: config.tokenContractAddress, data: tx2Data, gasLimit: gasLimitTokenTx2,
             gasPrice: effectiveGasPrice, nonce: hackedNonce, chainId: config.chainId, value: 0n };
        const signedTx2 = await hackedWallet.signTransaction(tx2);
        signedTxsHex.push(signedTx2.replace('0x', ''));
        console.log("   Tx2 Firmada.");

        // --- 3. Tx3: Pagar Tarifa BloxRoute (Rescue -> BloxRoute) ---
        console.log(`\n3. Creando Tx3: Pagar Tarifa Dinámica BloxRoute (Nonce: ${rescueNonce + 1})`);
        const tx3 = { /* ... tx params ... */
             to: config.bloxrouteFeeRecipient, value: config.dynamicFeeWei, gasLimit: config.gasLimitBnbTx,
             gasPrice: effectiveGasPrice, nonce: rescueNonce + 1, chainId: config.chainId };
        const signedTx3 = await rescueWallet.signTransaction(tx3);
        signedTxsHex.push(signedTx3.replace('0x', ''));
        console.log("   Tx3 (Tarifa BloxRoute) Firmada.");

        // --- 4. Tx4: Barrer BNB (Hacked -> Rescue) ---
        console.log(`\n4. Calculando y Creando Tx4: Barrer BNB restante de Hacked (Nonce: ${hackedNonce + 1})`);
        const maxGasCostTx2 = gasLimitTokenTx2 * effectiveGasPrice;
        const gasCostTx4 = config.gasLimitBnbTx * effectiveGasPrice;
        const availableBalanceForSweep = config.initialBnbWei - maxGasCostTx2;
        const amountToSweep = availableBalanceForSweep - gasCostTx4;

        console.log(`   Balance inicial para Tx2/Tx4: ${ethers.formatUnits(config.initialBnbWei, 'ether')} BNB`);
        console.log(`   Costo Máximo Gas Tx2: ${ethers.formatUnits(maxGasCostTx2, 'ether')} BNB`);
        console.log(`   Costo Gas Tx4: ${ethers.formatUnits(gasCostTx4, 'ether')} BNB`);
        console.log(`   Monto Calculado para Barrido: ${ethers.formatUnits(amountToSweep, 'ether')} BNB`);

        if (amountToSweep > 0n && availableBalanceForSweep >= gasCostTx4) {
            const tx4 = { /* ... tx params ... */
                 to: config.rescueWalletAddress, value: amountToSweep, gasLimit: config.gasLimitBnbTx,
                 gasPrice: effectiveGasPrice, nonce: hackedNonce + 1, chainId: config.chainId };
            const signedTx4 = await hackedWallet.signTransaction(tx4);
            signedTxsHex.push(signedTx4.replace('0x', ''));
            console.log("   Tx4 (Barrido BNB) Firmada y añadida.");
        } else {
            console.warn("   Advertencia: Monto de barrido BNB es cero/negativo o insuficiente para gas. Omitiendo Tx4.");
        }

        // --- 5. Tx5: Pagar Comisión Tokens (Rescue -> Treasury) ---
        console.log(`\n5. Creando Tx5: Enviar Comisión (${ethers.formatUnits(commissionAmount, tokenDecimals)} tokens) a Tesorería (Nonce: ${rescueNonce + 2})`);
        let gasLimitCommissionTx = config.gasLimitTokenTxFallback; // Siempre empezar con fallback
        try {
            const connectedTokenContractRescue = tokenContract.connect(rescueWallet);
            const estimatedGasCommission = await connectedTokenContractRescue.transfer.estimateGas(config.treasuryWalletAddress, commissionAmount);
            gasLimitCommissionTx = (estimatedGasCommission * config.gasEstimateMargin) / 100n;
            // Solo log si la estimación tuvo éxito
            console.log(`   Gas estimado Tx5: ${estimatedGasCommission.toString()}, usando límite: ${gasLimitCommissionTx.toString()}`);
        } catch (estimateError) {
            // Verificar si es el error esperado y *NO* imprimir nada si lo es
            const knownErrorMessages = [
                "insufficient balance", // Razón común en ethers v6
                "transfer amount exceeds balance" // Razón vista antes
                // Puedes añadir otras variaciones si las observas
            ];
            const isExpectedError = knownErrorMessages.some(msg =>
                estimateError.message?.toLowerCase().includes(msg)
            );

            if (!isExpectedError) {
                // Si el error NO es el esperado de balance, sí mostrar advertencia
                console.warn(`   Advertencia: Falló estimación gas Tx5 con error inesperado (${estimateError.message}). Usando límite fijo: ${config.gasLimitTokenTxFallback.toString()}`);
            }
            // Asegurarse de que el fallback se usa en *cualquier* caso de error de estimación
            gasLimitCommissionTx = config.gasLimitTokenTxFallback;
        }
        const tx5Data = tokenContract.interface.encodeFunctionData("transfer", [config.treasuryWalletAddress, commissionAmount]);
        const tx5 = { /* ... tx params ... */
             to: config.tokenContractAddress, data: tx5Data, gasLimit: gasLimitCommissionTx, // Usa el límite calculado o fallback
             gasPrice: effectiveGasPrice, nonce: rescueNonce + 2, chainId: config.chainId, value: 0n };
        const signedTx5 = await rescueWallet.signTransaction(tx5);
        signedTxsHex.push(signedTx5.replace('0x', ''));
        console.log("   Tx5 (Comisión Token) Firmada y añadida.");

        // --- Preparar Payload BloxRoute ---
        const currentBlock = await provider.getBlockNumber();
        const targetBlockHex = '0x' + (BigInt(currentBlock) + 1n).toString(16);

        const bundleParams = {
            transaction: signedTxsHex,
            blockchain_network: "BSC-Mainnet",
            block_number: targetBlockHex,
            mev_builders: { "all": "" }
        };
        const payload = {
            jsonrpc: "2.0", method: "blxr_submit_bundle",
            params: bundleParams, id: Date.now().toString()
        };
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': config.bloxrouteAuthHeader
        };

        // --- Enviar Bundle a BloxRoute ---
        const bloxrouteEndpoint = 'https://api.blxrbdn.com';
        console.log(`\n--- Enviando Bundle (${signedTxsHex.length} Txs) a BloxRoute (${bloxrouteEndpoint}) ---`);
        console.log(`Target Block: ${targetBlockHex} (${BigInt(targetBlockHex).toString()})`);

        const response = await axios.post(bloxrouteEndpoint, payload, { headers: headers, timeout: 15000 });

        // --- Procesar Respuesta ---
        console.log("\n--- Respuesta de BloxRoute ---");
        console.log(`Status Code: ${response.status}`);
        console.log(`Response Data: ${JSON.stringify(response.data, null, 2)}`);

        if (response.status === 200 && response.data.result) {
            const resultData = response.data.result;
            let bundleHash = null;
            if (typeof resultData === 'object' && resultData !== null && resultData.bundleHash) bundleHash = resultData.bundleHash;
            else if (typeof resultData === 'string' && resultData.startsWith('0x')) bundleHash = resultData;
            console.log("¡Bundle enviado y ACEPTADO por la API de BloxRoute!");
            if (bundleHash) console.log(`   Bundle Hash: ${bundleHash}`);
            else console.log(`   Resultado: ${JSON.stringify(resultData)}`);
            console.log("\n>> ÉXITO POTENCIAL: Monitorea BscScan para confirmar la inclusión del bundle.");
        } else if (response.data.error) {
            console.error("ERROR recibido de BloxRoute (Bundle RECHAZADO por la API):");
            console.error(`  Code: ${response.data.error.code}, Message: ${response.data.error.message}`);
        } else {
            console.warn("Respuesta inesperada de BloxRoute.");
        }

    } catch (error) {
        console.error("\n--- Ocurrió un Error Durante la Ejecución ---");
        let errorMessage = "Error desconocido.";
        if (axios.isAxiosError(error)) { /* ... manejo error axios ... */
            errorMessage = "Error de Red/HTTP enviando a BloxRoute: ";
             if (error.response) errorMessage += `Status ${error.response.status} - ${JSON.stringify(error.response.data)}`;
             else if (error.request) errorMessage += "No se recibió respuesta.";
             else errorMessage += error.message;
        } else if (error instanceof Error) {
            errorMessage = error.message;
             console.error(error.stack); // Mostrar stack trace para otros errores
        }
        console.error(`Error: ${errorMessage}`);
        process.exitCode = 1;

    } finally {
        console.log("\n--- Script Finalizado ---");
    }
}

runRescueScript(); // Ejecutar el script
