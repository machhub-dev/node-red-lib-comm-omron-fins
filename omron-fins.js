module.exports = function (RED) {
    const net = require('net');

    // Parse address to support bit notation (e.g., "1000.05")
    function parseAddress(address) {
        const addrStr = String(address).trim();
        const parts = addrStr.split('.');

        if (parts.length === 1) {
            // No bit notation, just word address
            return {
                wordAddress: parseInt(parts[0]),
                bitPosition: 0,
                isBitAddress: false
            };
        } else if (parts.length === 2) {
            // Bit notation: word.bit
            const wordAddress = parseInt(parts[0]);
            const bitPosition = parseInt(parts[1]);

            // Validate bit position (0-15)
            if (isNaN(bitPosition) || bitPosition < 0 || bitPosition > 15) {
                throw new Error(`Invalid bit position: ${parts[1]}. Bit position must be between 0 and 15.`);
            }

            return {
                wordAddress: wordAddress,
                bitPosition: bitPosition,
                isBitAddress: true
            };
        } else {
            throw new Error(`Invalid address format: ${address}. Use format like '1000' or '1000.05'`);
        }
    }

    function OmronFinsNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        this.config = RED.nodes.getNode(config.connection);
        this.operation = config.operation || "read";
        this.address = config.address || "";
        this.dataType = config.dataType || "DM";
        this.mode = config.mode || "RUN";
        this.addressMode = config.addressMode || "single";
        this.addressList = config.addressList || [];
        this.dataFormat = config.dataFormat || "array";

        if (!this.config) {
            node.error("Missing FINS configuration");
            return;
        }

        node.on('input', function (msg) {
            const operation = msg.operation || node.operation;
            let address = msg.address || node.address;
            const dataType = msg.dataType || node.dataType;
            const mode = msg.mode || node.mode;

            // Support for multiple addresses from UI or msg
            let isMultiRead = false;
            if (operation === 'read') {
                if (Array.isArray(address)) {
                    // msg.address is array
                    isMultiRead = true;
                } else if (node.addressMode === 'multiple' && node.addressList.length > 0) {
                    // UI configured multi-address
                    isMultiRead = true;
                    address = node.addressList;
                }
            }

            if (operation !== 'mode' && !address) {
                node.error("Address is required", msg);
                return;
            }

            if (operation === 'mode' && !mode) {
                node.error("Mode is required for mode operation", msg);
                return;
            }

            let completed = false;
            let handshakeComplete = false;
            let accessRightAcquired = false;
            let assignedNodeAddress = null;

            // Multi-read support
            let multiReadResults = [];
            let multiReadIndex = 0;
            let addressList = isMultiRead ? address : null;

            // Track address info and bit counts for formatting
            let currentAddressInfo = null;
            let currentBitCount = null;

            // Track write state for bit write operations (read-modify-write)
            let isWritingBits = false;
            let bitWriteData = null;

            node.status({ fill: "yellow", shape: "dot", text: "connecting" });

            const client = new net.Socket();
            const timeout = setTimeout(() => {
                completed = true;
                client.destroy();
                node.status({ fill: "red", shape: "ring", text: "timeout" });
                node.error("Connection timeout", msg);
            }, node.config.timeout);

            client.connect(node.config.port, node.config.host, function () {
                if (completed) return;
                node.status({ fill: "blue", shape: "dot", text: "handshake" });

                try {
                    // Send FINS/TCP handshake
                    const handshake = buildHandshake();
                    client.write(handshake);
                } catch (err) {
                    completed = true;
                    clearTimeout(timeout);
                    client.destroy();
                    node.status({ fill: "red", shape: "ring", text: "error" });
                    node.error("Error sending handshake: " + err.message, msg);
                }
            });

            client.on('data', function (data) {
                if (completed) return;

                try {
                    // Handle handshake response
                    if (!handshakeComplete) {
                        const handshakeResult = parseHandshakeResponse(data);
                        if (!handshakeResult.success) {
                            throw new Error("Handshake failed: " + handshakeResult.error);
                        }

                        assignedNodeAddress = handshakeResult.clientNode;
                        handshakeComplete = true;

                        // Check if we need access rights for this operation
                        if (operation === "mode") {
                            node.status({ fill: "blue", shape: "dot", text: "access rights" });
                            // Send access right acquire command
                            const accessCmd = buildAccessRightCommand(node.config, assignedNodeAddress);
                            client.write(accessCmd);
                            return;
                        }

                        // For read/write, send command directly
                        node.status({ fill: "green", shape: "dot", text: "sending command" });
                        let command;
                        if (operation === "read") {
                            if (isMultiRead) {
                                // Start with first address in array
                                const addrInfo = addressList[0];
                                const addr = typeof addrInfo === 'string' ? addrInfo : addrInfo.address;
                                const cnt = typeof addrInfo === 'object' && addrInfo.count ? addrInfo.count : (msg.count || 1);
                                const dt = typeof addrInfo === 'object' && addrInfo.dataType ? addrInfo.dataType : dataType;
                                const parsedAddr = parseAddress(addr);
                                currentAddressInfo = parsedAddr;
                                currentBitCount = cnt;
                                command = buildReadCommand(dt, addr, cnt, node.config, assignedNodeAddress, parsedAddr);
                            } else {
                                const parsedAddr = parseAddress(address);
                                currentAddressInfo = parsedAddr;
                                currentBitCount = msg.count || 1;
                                command = buildReadCommand(dataType, address, msg.count || 1, node.config, assignedNodeAddress, parsedAddr);
                            }
                        } else if (operation === "write") {
                            const parsedAddr = parseAddress(address);
                            currentAddressInfo = parsedAddr;

                            // If bit addressing, we need to do read-modify-write
                            if (parsedAddr.isBitAddress) {
                                isWritingBits = true;
                                bitWriteData = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
                                currentBitCount = bitWriteData.length;

                                // Calculate how many words to read for the bit range
                                const startBit = parsedAddr.bitPosition;
                                const endBit = startBit + bitWriteData.length - 1;
                                const startWord = Math.floor(startBit / 16);
                                const endWord = Math.floor(endBit / 16);
                                const wordCount = endWord - startWord + 1;

                                // First, read the current word(s)
                                command = buildReadCommand(dataType, address, wordCount, node.config, assignedNodeAddress, parsedAddr);
                            } else {
                                // Normal word write
                                command = buildWriteCommand(dataType, address, msg.payload, node.config, assignedNodeAddress, parsedAddr);
                            }
                        } else {
                            throw new Error("Invalid operation: " + operation);
                        }

                        client.write(command);
                        return;
                    }

                    // Handle access right response
                    if (handshakeComplete && !accessRightAcquired && operation === "mode") {
                        // Parse access right response (minimal check)
                        const header = data.toString('ascii', 0, 4);
                        if (header !== 'FINS') {
                            throw new Error("Invalid FINS header in access right response");
                        }

                        accessRightAcquired = true;
                        node.status({ fill: "green", shape: "dot", text: "sending command" });

                        // Now send the mode command
                        const command = buildModeCommand(mode, node.config, assignedNodeAddress);
                        node.warn("Sending mode command (" + mode + "), length: " + command.length + ", hex: " + command.toString('hex'));
                        client.write(command);
                        return;
                    }

                    // Handle FINS command response

                    // Log raw response for debugging
                    node.warn("Response buffer length: " + data.length + ", hex: " + data.toString('hex'));

                    const responseBuffer = parseFinsResponse(data);

                    // Handle bit write read-modify-write step
                    if (isWritingBits && operation === "write") {
                        // We just read the current word(s), now modify bits and write back
                        isWritingBits = false; // Reset flag

                        // Modify the bits in the buffer
                        const modifiedBuffer = modifyBitsInWords(responseBuffer, currentAddressInfo.bitPosition, bitWriteData);

                        // Convert buffer to array of words
                        const wordsToWrite = [];
                        for (let i = 0; i < modifiedBuffer.length; i += 2) {
                            if (i + 1 < modifiedBuffer.length) {
                                wordsToWrite.push(modifiedBuffer.readUInt16BE(i));
                            }
                        }

                        // Build write command with modified words
                        const writeCmd = buildWriteCommand(dataType, address, wordsToWrite, node.config, assignedNodeAddress, currentAddressInfo);
                        client.write(writeCmd);
                        return; // Wait for write response
                    }

                    // Handle multi-read operations
                    if (isMultiRead) {
                        // Store the result for current address
                        const addrInfo = addressList[multiReadIndex];
                        const addr = typeof addrInfo === 'string' ? addrInfo : addrInfo.address;
                        const dt = typeof addrInfo === 'object' && addrInfo.dataType ? addrInfo.dataType : dataType;

                        // Use per-address data format if available, otherwise use global format
                        const addrDataFormat = (typeof addrInfo === 'object' && addrInfo.dataFormat)
                            ? addrInfo.dataFormat
                            : (msg.dataFormat || node.dataFormat);

                        // Format the data
                        const formattedValue = formatData(responseBuffer, addrDataFormat, currentAddressInfo, currentBitCount);

                        multiReadResults.push({
                            address: addr,
                            dataType: dt,
                            value: formattedValue
                        });

                        multiReadIndex++;

                        // Check if there are more addresses to read
                        if (multiReadIndex < addressList.length) {
                            node.status({ fill: "green", shape: "dot", text: "reading " + (multiReadIndex + 1) + "/" + addressList.length });

                            // Send next read command
                            const nextAddrInfo = addressList[multiReadIndex];
                            const nextAddr = typeof nextAddrInfo === 'string' ? nextAddrInfo : nextAddrInfo.address;
                            const nextCnt = typeof nextAddrInfo === 'object' && nextAddrInfo.count ? nextAddrInfo.count : (msg.count || 1);
                            const nextDt = typeof nextAddrInfo === 'object' && nextAddrInfo.dataType ? nextAddrInfo.dataType : dataType;
                            const parsedNextAddr = parseAddress(nextAddr);
                            currentAddressInfo = parsedNextAddr;
                            currentBitCount = nextCnt;

                            const command = buildReadCommand(nextDt, nextAddr, nextCnt, node.config, assignedNodeAddress, parsedNextAddr);
                            client.write(command);
                            return; // Wait for next response
                        }

                        // All reads completed
                        completed = true;
                        clearTimeout(timeout);
                        msg.payload = multiReadResults;
                        node.send(msg);
                        node.status({ fill: "green", shape: "dot", text: "success" });
                    } else {
                        // Single read/write operation
                        completed = true;
                        clearTimeout(timeout);

                        // Format the data using global format
                        const dataFormat = msg.dataFormat || node.dataFormat;
                        const formattedValue = formatData(responseBuffer, dataFormat, currentAddressInfo, currentBitCount);
                        msg.payload = formattedValue;
                        node.send(msg);
                        node.status({ fill: "green", shape: "dot", text: "success" });
                    }
                } catch (err) {
                    completed = true;
                    clearTimeout(timeout);
                    node.error("Error: " + err.message, msg);
                    node.status({ fill: "red", shape: "ring", text: "error" });
                } finally {
                    if (completed) {
                        client.destroy();
                    }
                }
            });

            client.on('error', function (err) {
                if (completed) return;
                completed = true;
                clearTimeout(timeout);
                node.status({ fill: "red", shape: "ring", text: "error" });
                node.error("Connection error: " + err.message, msg);
            });

            client.on('close', function () {
                clearTimeout(timeout);
                // Clear status after a short delay if operation completed successfully
                if (completed) {
                    setTimeout(() => {
                        node.status({});
                    }, 1000);
                }
            });
        });

        node.on('close', function () {
            node.status({});
        });
    }

    function buildHandshake() {
        // FINS/TCP handshake frame
        // Reference: FINS Command Reference Manual Section 2-3
        const buffer = Buffer.alloc(20);

        // Header: 'FINS' (4 bytes)
        buffer.write('FINS', 0, 4, 'ascii');

        // Length: 0x0000000C (4 bytes) - 12 bytes after length field
        // (Command 4 + Error 4 + Client node 4 = 12 bytes)
        buffer.writeUInt32BE(0x0000000C, 4);

        // Command: 0x00000000 (4 bytes) - Node address data send
        buffer.writeUInt32BE(0x00000000, 8);

        // Error code: 0x00000000 (4 bytes)
        buffer.writeUInt32BE(0x00000000, 12);

        // Client node address: 0x00000000 (4 bytes) - 0 = auto-assign
        buffer.writeUInt32BE(0x00000000, 16);

        return buffer;
    }

    function parseHandshakeResponse(buffer) {
        // FINS/TCP handshake response is 24 bytes
        if (buffer.length < 24) {
            return { success: false, error: "Invalid handshake response length: " + buffer.length };
        }

        // Check header 'FINS'
        const header = buffer.toString('ascii', 0, 4);
        if (header !== 'FINS') {
            return { success: false, error: "Invalid handshake header: " + header };
        }

        // Check error code (bytes 12-15)
        const errorCode = buffer.readUInt32BE(12);
        if (errorCode !== 0x00000000) {
            return { success: false, error: "Handshake error code: 0x" + errorCode.toString(16) };
        }

        // Get assigned client node address (bytes 16-19)
        const clientNode = buffer.readUInt32BE(16);

        // Get assigned server node address (bytes 20-23)
        const serverNode = buffer.readUInt32BE(20);

        return {
            success: true,
            clientNode: clientNode,
            serverNode: serverNode
        };
    }

    function buildAccessRightCommand(config, clientNode) {
        // ACCESS RIGHT FORCED ACQUIRE command
        // Command: 0C 01
        const finsFrame = Buffer.from([
            0x80, 0x00, 0x02,
            0x00, config.DA2 || 0x01, 0x00, // Dest Node (PLC)
            0x00, clientNode || 0x00, 0x00, // Src Node (Client)
            0x00,
            0x0C, 0x01,       // Command: ACCESS RIGHT FORCED ACQUIRE
            0xFF, 0xFF, 0xFF, 0xFF  // Clear code (all FFs for forced acquire)
        ]);

        // Build FINS/TCP header
        const header = Buffer.alloc(16);
        header.write('FINS', 0, 4, 'ascii');
        header.writeUInt32BE(8 + finsFrame.length, 4);  // Length
        header.writeUInt32BE(0x02, 8);   // Command 2: Send Frame
        header.writeUInt32BE(0x00, 12);  // Error code

        return Buffer.concat([header, finsFrame]);
    }

    function buildReadCommand(dataType, address, count, config, clientNode, addressInfo) {
        // FINS command structure for memory area read
        const finsFrame = Buffer.alloc(16); // FINS command frame

        // FINS Command frame
        finsFrame.writeUInt8(0x80, 0);   // ICF
        finsFrame.writeUInt8(0x00, 1);   // RSV
        finsFrame.writeUInt8(0x02, 2);   // GCT
        finsFrame.writeUInt8(0x00, 3);   // DNA: Destination network
        finsFrame.writeUInt8(config.DA2 || 0x01, 4);   // DA1: Destination node (PLC)
        finsFrame.writeUInt8(0x00, 5);   // DA2: Destination unit
        finsFrame.writeUInt8(0x00, 6);   // SNA: Source network
        finsFrame.writeUInt8(clientNode || 0x00, 7);   // SA1: Source node (Client)
        finsFrame.writeUInt8(0x00, 8);   // SA2: Source unit
        finsFrame.writeUInt8(0x00, 9);   // SID

        // Memory area read command (0x01 0x01)
        finsFrame.writeUInt8(0x01, 10);
        finsFrame.writeUInt8(0x01, 11);

        // Memory area code
        const areaCode = getMemoryAreaCode(dataType);
        finsFrame.writeUInt8(areaCode, 12);

        // Address - use wordAddress from parsed address info
        const addr = addressInfo.wordAddress;
        finsFrame.writeUInt16BE(addr, 13);
        finsFrame.writeUInt8(0x00, 15);  // Bit position (always 0, we handle bits in post-processing)

        // Number of words to read
        // If bit addressing, calculate how many words we need for the bit count
        let wordCount = count;
        if (addressInfo.isBitAddress) {
            // count is in bits, calculate words needed
            const startBit = addressInfo.bitPosition;
            const endBit = startBit + count - 1;
            const startWord = Math.floor(startBit / 16);
            const endWord = Math.floor(endBit / 16);
            wordCount = endWord - startWord + 1;
        }

        const countBytes = Buffer.alloc(2);
        countBytes.writeUInt16BE(wordCount, 0);

        // Build FINS/TCP header
        const header = Buffer.alloc(16);
        header.write('FINS', 0, 4, 'ascii');
        header.writeUInt32BE(8 + finsFrame.length + countBytes.length, 4);  // Length
        header.writeUInt32BE(0x02, 8);   // Command 2: Send Frame
        header.writeUInt32BE(0x00, 12);  // Error code

        return Buffer.concat([header, finsFrame, countBytes]);
    }

    function buildWriteCommand(dataType, address, data, config, clientNode, addressInfo) {
        // FINS command structure for memory area write
        const values = Array.isArray(data) ? data : [data];

        // FINS frame: 10 bytes header + 6 bytes command + data
        const finsFrame = Buffer.alloc(16 + values.length * 2);

        // FINS Command frame header
        finsFrame.writeUInt8(0x80, 0);   // ICF
        finsFrame.writeUInt8(0x00, 1);   // RSV
        finsFrame.writeUInt8(0x02, 2);   // GCT
        finsFrame.writeUInt8(0x00, 3);   // DNA: Destination network
        finsFrame.writeUInt8(config.DA2 || 0x01, 4);   // DA1: Destination node (PLC)
        finsFrame.writeUInt8(0x00, 5);   // DA2: Destination unit
        finsFrame.writeUInt8(0x00, 6);   // SNA: Source network
        finsFrame.writeUInt8(clientNode || 0x00, 7);   // SA1: Source node (Client)
        finsFrame.writeUInt8(0x00, 8);   // SA2: Source unit
        finsFrame.writeUInt8(0x00, 9);   // SID

        // Memory area write command (0x01 0x02)
        finsFrame.writeUInt8(0x01, 10);
        finsFrame.writeUInt8(0x02, 11);

        // Memory area code
        const areaCode = getMemoryAreaCode(dataType);
        finsFrame.writeUInt8(areaCode, 12);

        // Address - use wordAddress from parsed address info
        const addr = addressInfo.wordAddress;
        finsFrame.writeUInt16BE(addr, 13);
        finsFrame.writeUInt8(0x00, 15);  // Bit position (always 0, we handle bits in processing)

        // Number of items to write
        finsFrame.writeUInt16BE(values.length, 16);

        // Data
        for (let i = 0; i < values.length; i++) {
            finsFrame.writeUInt16BE(values[i], 18 + i * 2);
        }

        // Build FINS/TCP header
        const header = Buffer.alloc(16);
        header.write('FINS', 0, 4, 'ascii');
        header.writeUInt32BE(8 + finsFrame.length, 4);  // Length
        header.writeUInt32BE(0x02, 8);   // Command 2: Send Frame
        header.writeUInt32BE(0x00, 12);  // Error code

        return Buffer.concat([header, finsFrame]);
    }

    function buildModeCommand(mode, config, clientNode) {
        // FINS command structure for RUN/MONITOR/STOP
        // Reference: FINS Commands Reference Manual - RUN (04 01) and STOP (04 02)
        const modeUpper = mode.toUpperCase();

        let finsFrame;
        if (modeUpper === 'STOP') {
            // STOP: 04 02 (no mode parameter needed)
            finsFrame = Buffer.from([
                0x80, 0x00, 0x02,
                0x00, config.DA2 || 0x01, 0x00, // Dest Node (PLC)
                0x00, clientNode || 0x00, 0x00, // Src Node (Client)
                0x00,
                0x04, 0x02        // Command: STOP (no additional data)
            ]);
        } else if (modeUpper === 'RUN') {
            // RUN: 04 01 [Program number] [Mode]
            // Program number: FF FF (default/current program)
            // Mode: 04 = RUN mode
            finsFrame = Buffer.from([
                0x80, 0x00, 0x02,
                0x00, config.DA2 || 0x01, 0x00, // Dest Node (PLC)
                0x00, clientNode || 0x00, 0x00, // Src Node (Client)
                0x00,
                0x04, 0x01,       // Command: RUN
                0xFF, 0xFF,       // Program number (FF FF = current/default)
                0x04              // Mode: 04 = RUN
            ]);
        } else if (modeUpper === 'MONITOR') {
            // MONITOR: 04 01 [Program number] [Mode]
            // Program number: FF FF (default/current program)
            // Mode: 02 = MONITOR mode
            finsFrame = Buffer.from([
                0x80, 0x00, 0x02,
                0x00, config.DA2 || 0x01, 0x00, // Dest Node (PLC)
                0x00, clientNode || 0x00, 0x00, // Src Node (Client)
                0x00,
                0x04, 0x01,       // Command: RUN
                0xFF, 0xFF,       // Program number (FF FF = current/default)
                0x02              // Mode: 02 = MONITOR
            ]);
        } else {
            throw new Error("Invalid mode: " + mode + ". Use RUN, MONITOR, or STOP");
        }

        // Build FINS/TCP header
        const header = Buffer.alloc(16);
        header.write('FINS', 0, 4, 'ascii');
        header.writeUInt32BE(8 + finsFrame.length, 4);  // Length
        header.writeUInt32BE(0x02, 8);   // Command 2: Send Frame
        header.writeUInt32BE(0x00, 12);  // Error code

        return Buffer.concat([header, finsFrame]);
    }

    function getMemoryAreaCode(dataType) {
        const areaCodes = {
            'CIO': 0xB0,
            'WR': 0xB1,
            'HR': 0xB2,
            'AR': 0xB3,
            'DM': 0x82,
            'EM': 0xA0
        };
        return areaCodes[dataType] || 0x82; // Default to DM
    }

    function parseFinsResponse(buffer) {
        // FINS/TCP response format: 16-byte header + FINS response
        if (buffer.length < 16) {
            throw new Error("Invalid response length (too short for header): " + buffer.length);
        }

        // Check FINS/TCP header
        const header = buffer.toString('ascii', 0, 4);
        if (header !== 'FINS') {
            throw new Error("Invalid FINS header: " + header);
        }

        const length = buffer.readUInt32BE(4);
        const command = buffer.readUInt32BE(8);
        const headerErrorCode = buffer.readUInt32BE(12);

        if (headerErrorCode !== 0) {
            throw new Error("FINS/TCP header error code: 0x" + headerErrorCode.toString(16));
        }

        // FINS response starts at byte 16
        if (buffer.length < 16 + 12) {
            // Short response (e.g., mode change confirmation)
            // Still check for FINS error code if available
            if (buffer.length >= 16 + 14) {
                const endCode = buffer.readUInt16BE(28);
                if (endCode !== 0) {
                    throw new Error("FINS error code: 0x" + endCode.toString(16));
                }
            }
            return null;
        }

        // Command code at offset 10-11 from FINS start (byte 26-27 overall)
        // End code at offset 12-13 from FINS start (byte 28-29 overall)
        const commandCode = buffer.readUInt16BE(26);
        const endCode = buffer.readUInt16BE(28);

        if (endCode !== 0) {
            // Provide more detailed error information
            const errorDetails = getFinsErrorDescription(endCode);
            throw new Error("FINS error code: 0x" + endCode.toString(16) + " - " + errorDetails);
        }

        // Extract data values if present (starts at byte 30)
        const dataStart = 30;
        if (buffer.length <= dataStart) {
            return null;
        }

        const dataLength = buffer.length - dataStart;

        // Return raw buffer slice for formatting
        if (dataLength > 0) {
            return buffer.slice(dataStart);
        }

        return null;
    }

    // Extract specific bits from word data buffer
    function extractBitsFromWords(buffer, startBit, bitCount) {
        const bits = [];
        const words = [];

        // First, extract all words from buffer
        for (let i = 0; i < buffer.length; i += 2) {
            if (i + 1 < buffer.length) {
                words.push(buffer.readUInt16BE(i));
            }
        }

        // Now extract the specific bits
        for (let i = 0; i < bitCount; i++) {
            const absoluteBitPos = startBit + i;
            const wordIndex = Math.floor(absoluteBitPos / 16);
            const bitInWord = absoluteBitPos % 16;

            if (wordIndex < words.length) {
                const word = words[wordIndex];
                // Extract bit (bit 0 is LSB, bit 15 is MSB)
                const bitValue = (word >> bitInWord) & 1;
                bits.push(bitValue === 1);
            }
        }

        return bits;
    }

    // Modify specific bits in word buffer for bit write operations
    function modifyBitsInWords(buffer, startBit, bitValues) {
        const words = [];

        // Extract all words from buffer
        for (let i = 0; i < buffer.length; i += 2) {
            if (i + 1 < buffer.length) {
                words.push(buffer.readUInt16BE(i));
            }
        }

        // Modify the specific bits
        for (let i = 0; i < bitValues.length; i++) {
            const absoluteBitPos = startBit + i;
            const wordIndex = Math.floor(absoluteBitPos / 16);
            const bitInWord = absoluteBitPos % 16;

            if (wordIndex < words.length) {
                const bitValue = bitValues[i];
                // Convert to 1 or 0
                const bitNum = (bitValue === true || bitValue === 1 || bitValue === '1') ? 1 : 0;

                if (bitNum === 1) {
                    // Set bit
                    words[wordIndex] |= (1 << bitInWord);
                } else {
                    // Clear bit
                    words[wordIndex] &= ~(1 << bitInWord);
                }
            }
        }

        // Write modified words back to buffer
        for (let i = 0; i < words.length; i++) {
            buffer.writeUInt16BE(words[i], i * 2);
        }

        return buffer;
    }

    function formatData(buffer, format, addressInfo, bitCount) {
        if (!buffer || buffer.length === 0) {
            return null;
        }

        // If bit addressing is used, extract specific bits
        if (addressInfo && addressInfo.isBitAddress) {
            const bits = extractBitsFromWords(buffer, addressInfo.bitPosition, bitCount || 1);
            // Return single boolean for single bit, array for multiple bits
            return bits.length === 1 ? bits[0] : bits;
        }

        switch (format) {
            case 'array': // Signed 16-bit integers
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            values.push(buffer.readInt16BE(i));
                        }
                    }
                    return values;
                }

            case 'unsigned': // Unsigned 16-bit integers
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            values.push(buffer.readUInt16BE(i));
                        }
                    }
                    return values;
                }

            case 'int32': // 32-bit signed integers (combine pairs of words)
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 4) {
                        if (i + 3 < buffer.length) {
                            values.push(buffer.readInt32BE(i));
                        }
                    }
                    return values;
                }

            case 'float32': // 32-bit IEEE 754 floats (combine pairs of words)
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 4) {
                        if (i + 3 < buffer.length) {
                            values.push(buffer.readFloatBE(i));
                        }
                    }
                    return values;
                }

            case 'binary': // Binary string array (16 bits each)
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            const word = buffer.readUInt16BE(i);
                            values.push(word.toString(2).padStart(16, '0'));
                        }
                    }
                    return values;
                }

            case 'hex': // Hex string array
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            const word = buffer.readUInt16BE(i);
                            values.push(word.toString(16).toUpperCase().padStart(4, '0'));
                        }
                    }
                    return values;
                }

            case 'ascii': // ASCII string (2 bytes per word)
                {
                    let str = '';
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            const word = buffer.readUInt16BE(i);
                            const char1 = (word >> 8) & 0xFF;
                            const char2 = word & 0xFF;
                            if (char1 !== 0) str += String.fromCharCode(char1);
                            if (char2 !== 0) str += String.fromCharCode(char2);
                        }
                    }
                    return str;
                }

            case 'buffer': // Raw buffer
                return buffer;

            case 'bits': // Array of bit arrays (each word as 16 booleans)
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            const word = buffer.readUInt16BE(i);
                            const bits = [];
                            for (let bit = 15; bit >= 0; bit--) {
                                bits.push((word & (1 << bit)) !== 0);
                            }
                            values.push(bits);
                        }
                    }
                    return values;
                }

            default:
                // Default to signed array
                {
                    const values = [];
                    for (let i = 0; i < buffer.length; i += 2) {
                        if (i + 1 < buffer.length) {
                            values.push(buffer.readInt16BE(i));
                        }
                    }
                    return values;
                }
        }
    }

    function getFinsErrorDescription(errorCode) {
        const errors = {
            0x0001: "Service canceled",
            0x0101: "Local node not in network",
            0x0102: "Token timeout",
            0x0103: "Retries failed",
            0x0104: "Too many send frames",
            0x0105: "Node address range error",
            0x0106: "Node address duplication",
            0x0201: "Destination node not in network",
            0x0202: "Unit missing",
            0x0203: "Third node missing",
            0x0204: "Destination node busy",
            0x0205: "Response timeout",
            0x0301: "Communications controller error",
            0x0302: "CPU Unit error",
            0x0303: "Controller error",
            0x0304: "Unit number error",
            0x0401: "Undefined command",
            0x0402: "Not supported by model/version",
            0x0501: "Destination address setting error",
            0x0502: "No routing tables",
            0x0503: "Routing table error",
            0x0504: "Too many relays",
            0x1001: "Command too long",
            0x1002: "Command too short",
            0x1003: "Elements/data don't match",
            0x1004: "Command format error",
            0x1005: "Header error",
            0x1101: "Area classification missing",
            0x1102: "Access size error",
            0x1103: "Address range error",
            0x1104: "Address range exceeded",
            0x1106: "Program missing",
            0x1109: "Relational error",
            0x110A: "Duplicate data access",
            0x110B: "Response too long",
            0x110C: "Parameter error",
            0x2002: "Protected",
            0x2003: "Table missing",
            0x2004: "Data missing",
            0x2005: "Program missing",
            0x2006: "File missing",
            0x2007: "Data mismatch",
            0x2101: "Read-only",
            0x2102: "Protected - cannot write data link table",
            0x2103: "Cannot register",
            0x2105: "Program missing",
            0x2106: "File missing",
            0x2107: "File name already exists",
            0x2108: "Cannot change"
        };
        return errors[errorCode] || "Unknown error";
    }

    RED.nodes.registerType("omron-fins", OmronFinsNode);
};
