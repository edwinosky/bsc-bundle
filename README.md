# BSC Rescue Bundle Sender (BloxRoute)

Este script de Node.js está diseñado para rescatar tokens ERC-20 (y el BNB restante) de una wallet comprometida en la Binance Smart Chain (BSC) utilizando la API de bundles de BloxRoute. Envía un conjunto atómico de transacciones para asegurar que las operaciones ocurran en secuencia dentro del mismo bloque, minimizando el riesgo de fallos parciales o front-running.

El script también incluye una funcionalidad para enviar una comisión (20% de los tokens rescatados) a una wallet de tesorería designada, la cual solo se ejecuta si el rescate principal de tokens tiene éxito.

**ADVERTENCIA DE SEGURIDAD:** Este script maneja claves privadas directamente, incluyendo la clave de la wallet comprometida. Úsalo bajo tu propio riesgo y SOLO en un entorno local seguro y de confianza. NUNCA expongas tus claves privadas.

## ¿Cómo Funciona?

El script realiza los siguientes pasos:

1.  **Carga Configuración:** Lee las direcciones de las wallets, claves privadas, dirección del token, configuración de BloxRoute y otros parámetros desde un archivo `.env`.
2.  **Conecta a BSC:** Establece una conexión a un nodo RPC de BSC.
3.  **Obtiene Datos:** Consulta la blockchain para obtener los nonces actuales de las wallets involucradas, el balance del token en la wallet comprometida y el precio base del gas.
4.  **Calcula Tarifas:** Determina el precio efectivo del gas (base + propina) y calcula la comisión del 20% sobre los tokens a rescatar.
5.  **Construye Transacciones:** Prepara una secuencia de 5 transacciones:
    *   **Tx1:** Envía una pequeña cantidad de BNB desde la `RESCUE_WALLET` a la `HACKED_WALLET` para cubrir el gas de las transacciones que esta última debe firmar (Tx2, Tx4).
    *   **Tx2:** Transfiere el **100%** del balance del `TOKEN_CONTRACT_ADDRESS` desde la `HACKED_WALLET` a la `RESCUE_WALLET`.
    *   **Tx3:** Envía la tarifa dinámica de BNB requerida por BloxRoute desde la `RESCUE_WALLET` a la dirección del receptor de tarifas de BloxRoute.
    *   **Tx4:** Barre (transfiere) el BNB restante calculado de la `HACKED_WALLET` de vuelta a la `RESCUE_WALLET`, después de descontar los costos de gas estimados para Tx2 y la propia Tx4. (Esta transacción se omite si el cálculo indica que no quedará BNB suficiente).
    *   **Tx5:** Transfiere la comisión del 20% de los tokens (calculada previamente) desde la `RESCUE_WALLET` (que ya recibió los tokens en Tx2) a la `TREASURY_WALLET`.
6.  **Firma Transacciones:** Firma cada transacción con la clave privada correcta:
    *   `RESCUE_PRIVATE_KEY` firma Tx1, Tx3 y Tx5.
    *   `HACKED_PRIVATE_KEY` firma Tx2 y Tx4.
7.  **Prepara el Bundle:** Formatea las transacciones firmadas (como hexadecimales crudos sin `0x`) en la estructura JSON requerida por la API de BloxRoute (`blxr_submit_bundle`).
8.  **Envía a BloxRoute:** Realiza una solicitud HTTP POST a la API Cloud de BloxRoute (`api.blxrbdn.com`) incluyendo el bundle y la cabecera de autenticación necesaria.
9.  **Muestra Respuesta:** Imprime la respuesta de la API de BloxRoute, indicando si el bundle fue aceptado (y proporcionando el hash del bundle) o si hubo un error.

## Prerrequisitos

*   **Node.js:** Versión 18 o superior recomendada.
*   **npm:** Generalmente incluido con Node.js.
*   **Cuenta BloxRoute:** Necesitas acceso a la Cloud API de BloxRoute (para BSC) para obtener tu cabecera de autorización (`Authorization Header`).
*   **Wallets y Fondos:**
    *   La `RESCUE_WALLET` debe tener suficiente BNB para cubrir:
        *   El BNB inicial enviado a la `HACKED_WALLET` (`INITIAL_BNB_WEI`).
        *   La tarifa dinámica de BloxRoute (`DYNAMIC_FEE_WEI`).
        *   El gas para Tx1, Tx3 y Tx5.
    *   Acceso a las **claves privadas** tanto de `RESCUE_WALLET` como de `HACKED_WALLET`.

## Instalación

1.  **Clona el repositorio:**
    ```bash
    git clone https://github.com/edwinosky/bsc-bundle
    cd bsc-bundle
    ```
2.  **Instala las dependencias:**
    ```bash
    npm install
    ```

## Configuración

1.  **Crea un archivo `.env`** en la raíz del proyecto. **¡NUNCA subas este archivo a GitHub! Añádelo a tu `.gitignore`.**
2.  **Añade las siguientes variables** al archivo `.env`, reemplazando los valores de ejemplo con los tuyos:

    ```dotenv
    # --- Wallets ---
    RESCUE_WALLET_ADDRESS=0xTU_WALLET_SEGURA
    HACKED_WALLET_ADDRESS=0xTU_WALLET_HACKEADA
    TREASURY_WALLET_ADDRESS=0xTU_WALLET_TESORERIA_PARA_COMISION

    # --- Claves Privadas ---
    RESCUE_PRIVATE_KEY=TU_CLAVE_PRIVADA_SEGURA_SIN_0x
    HACKED_PRIVATE_KEY=TU_CLAVE_PRIVADA_HACKEADA_SIN_0x

    # --- Token a Rescatar ---
    TOKEN_CONTRACT_ADDRESS=0xEL_CONTRATO_DEL_TOKEN_A_RESCATAR

    # --- BloxRoute ---
    BLOXROUTE_AUTH_HEADER="Authorization: TU_API_KEY:TU_SECRETO" # O el formato correcto que te dio BloxRoute
    BLOXROUTE_FEE_RECIPIENT=0x74c5F8C6ffe41AD4789602BDB9a48E6Cad623520 # Dirección oficial de BloxRoute BSC

    # --- Configuración Opcional ---
    BSC_RPC_URL=https://bsc-dataseed.binance.org/       # Nodo RPC de BSC
    PRIORITY_FEE_GWEI=5                               # Propina en Gwei sobre el precio base del gas
    INITIAL_BNB_WEI=3500000000000000                  # BNB (en Wei) a enviar a la wallet hackeada (ej: 0.0035 BNB)
    DYNAMIC_FEE_WEI=1000000000000000                  # Tarifa BNB (en Wei) para BloxRoute (ej: 0.001 BNB)
    ```

3.  **Ajusta los valores** de `PRIORITY_FEE_GWEI`, `INITIAL_BNB_WEI` y `DYNAMIC_FEE_WEI` según la congestión de la red y la competitividad deseada para tu bundle. Valores más altos aumentan la probabilidad de inclusión pero cuestan más.

## Uso

Una vez configurado el archivo `.env`, ejecuta el script desde la terminal:

```bash
npm start
