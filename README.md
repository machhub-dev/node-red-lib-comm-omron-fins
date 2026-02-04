# node-red-lib-comm-omron-fins

Node-RED nodes for communicating with Omron PLCs using the FINS (Factory Interface Network Service) protocol over TCP/IP and UDP/IP.

## Tested PLCs

The following Omron PLC series support the FINS protocol. Testing status:

| PLC Series | Models                 | Status                |
| ---------- | ---------------------- | --------------------- |
| **CP2E**   | CP2E-N, CP2E-S, CP2E-E | ✅ **Tested** (CP2E-N) |
| **CP1**    | CP1E, CP1H, CP1L       | ⏳ Not tested yet      |
| **CJ2**    | CJ2M, CJ2H             | ⏳ Not tested yet      |
| **CJ1**    | CJ1M, CJ1G, CJ1H       | ⏳ Not tested yet      |
| **CS1**    | CS1G, CS1H, CS1D       | ⏳ Not tested yet      |
| **NJ**     | NJ101, NJ301, NJ501    | ⏳ Not tested yet      |
| **NX**     | NX1P2, NX102           | ⏳ Not tested yet      |
| **FQM1**   | FQM1 series            | ⏳ Not tested yet      |

If you successfully test this library with other PLC models, please report your findings so we can update this table.

## Implemented FINS Commands

This library currently implements a subset of the FINS protocol commands:

| Command                         | Code      | Description                                                    | Status                   |
| ------------------------------- | --------- | -------------------------------------------------------------- | ------------------------ |
| **Memory Area Read**            | 0x01 0x01 | Read word/bit data from memory areas (CIO, WR, HR, AR, DM, EM) | ✅ Implemented            |
| **Memory Area Write**           | 0x01 0x02 | Write word/bit data to memory areas                            | ✅ Implemented            |
| **RUN**                         | 0x04 0x01 | Change PLC mode to RUN or MONITOR                              | ✅ Implemented (TCP only) |
| **STOP**                        | 0x04 0x02 | Change PLC to STOP mode                                        | ✅ Implemented (TCP only) |
| **Access Right Forced Acquire** | 0x0C 0x01 | Acquire exclusive access rights for mode changes               | ✅ Implemented (TCP only) |

**Note:** RUN and MONITOR modes both use command 0x04 0x01, differentiated by the mode parameter (0x04 for RUN, 0x02 for MONITOR).

### Not Yet Implemented

The following FINS commands are **not yet implemented** but may be added in future versions:

| Command                       | Code           | Description                               | Status            |
| ----------------------------- | -------------- | ----------------------------------------- | ----------------- |
| **Multiple Memory Area Read** | 0x01 0x04      | Read multiple memory areas in one command | ⏳ Not implemented |
| **Memory Area Fill**          | 0x01 0x03      | Fill memory area with same data           | ⏳ Not implemented |
| **Memory Area Transfer**      | 0x01 0x05      | Transfer data between memory areas        | ⏳ Not implemented |
| **Parameter Area Read**       | 0x02 0x01      | Read PLC parameters                       | ⏳ Not implemented |
| **Parameter Area Write**      | 0x02 0x02      | Write PLC parameters                      | ⏳ Not implemented |
| **Parameter Area Clear**      | 0x02 0x03      | Clear parameter area                      | ⏳ Not implemented |
| **Program Area Read**         | 0x03 0x06      | Read program data                         | ⏳ Not implemented |
| **Program Area Write**        | 0x03 0x07      | Write program data                        | ⏳ Not implemented |
| **Program Area Clear**        | 0x03 0x08      | Clear program area                        | ⏳ Not implemented |
| **Status Read**               | 0x06 0x01      | Read CPU Unit status                      | ⏳ Not implemented |
| **Clock Read**                | 0x07 0x01      | Read PLC clock                            | ⏳ Not implemented |
| **Clock Write**               | 0x07 0x02      | Write PLC clock                           | ⏳ Not implemented |
| **Error Log Read**            | 0x21 0x01      | Read error log                            | ⏳ Not implemented |
| **Error Log Clear**           | 0x21 0x02      | Clear error log                           | ⏳ Not implemented |
| **Forced Set/Reset**          | 0x23 0x01/0x02 | Force set/reset I/O bits                  | ⏳ Not implemented |
| **File Memory Operations**    | Various        | File read/write/format operations         | ⏳ Not implemented |

### Special Features Implemented

- **Bit-level addressing** - Read/write individual bits using "word.bit" notation (e.g., "100.05")
- **Multi-address read** - Read multiple addresses in a single operation
- **Multiple data formats** - Support for signed/unsigned, int32, float32, binary, hex, ASCII, buffer, and bit arrays
- **Read-modify-write for bits** - Preserve other bits when writing to specific bits

## Installation

### Using npm (when published)
```bash
npm install node-red-lib-comm-omron-fins
```

### Local Development
```bash
cd ~/.node-red
npm install /path/to/node-red-lib-comm-omron-fins
```

Then restart Node-RED.

## Nodes

### omron-fins-tcp (TCP)

A node for reading and writing data to/from Omron PLCs using the FINS protocol over TCP/IP.

#### When to use TCP
- Reliable, connection-oriented communication
- Critical operations where data integrity is essential
- Lower message rates where connection overhead is acceptable
- When you need guaranteed message delivery

#### Configuration

- **Connection**: Reference to an omron-fins-config node
- **Input Mode**: Controls parameter source
  - **Use Node Settings** (default): Uses the configured operation, data type, and address from the node settings
  - **Use Input Message**: Reads all parameters from the input message (msg.operation, msg.dataType, msg.address, etc.)
- **Operation**: Read, Write, or Change Mode operation (only used when Input Mode is "Use Node Settings")
- **Data Type**: Memory area type (CIO, WR, HR, AR, DM, EM)
- **Address**: Memory address to access (supports bit notation like "100.05" for bit 5 of word 100)

#### Input

**When Input Mode is "Use Node Settings":**
- The node uses its configured settings
- Input message properties are ignored

**When Input Mode is "Use Input Message":**
- All parameters must be provided in the input message:
  - `msg.operation` (string, required): "read", "write", or "mode"
  - `msg.dataType` (string, required for read/write): Memory area type (CIO, WR, HR, AR, DM, EM)
  - `msg.address` (string, required for read/write): Memory address (supports bit notation like "100.05")
  - `msg.count` (number, optional): Number of words/bits to read (default: 1)
  - `msg.dataFormat` (string, optional): Output format for read data (default: "array")
  - `msg.payload` (number|array|boolean, required for write): Data to write
  - `msg.mode` (string, required for mode operation): "RUN", "MONITOR", or "STOP"

**Data Format Options:**

| Format     | Description                                 | Output Type      |
| ---------- | ------------------------------------------- | ---------------- |
| `array`    | Signed 16-bit integers (default)            | Array of numbers |
| `unsigned` | Unsigned 16-bit integers (0-65535)          | Array of numbers |
| `int32`    | 32-bit signed integers (pairs of words)     | Array of numbers |
| `float32`  | IEEE 754 32-bit floats (pairs of words)     | Array of numbers |
| `binary`   | Binary string representation (16 bits each) | Array of strings |
| `hex`      | Hexadecimal string representation           | Array of strings |
| `ascii`    | ASCII text string                           | String           |
| `buffer`   | Raw Node.js Buffer object                   | Buffer           |
| `bits`     | Bit arrays (each word as 16 booleans)       | Array of arrays  |

#### Output

For read operations, the node outputs:
- `msg.payload` (number|array): The data read from the PLC

#### Examples

**Read 10 words from DM100:**
```javascript
msg.operation = "read";
msg.dataType = "DM";
msg.address = "100";
msg.count = 10;
msg.dataFormat = "unsigned"; // Optional: specify output format
return msg;
```

**Read bit 5 from DM100:**
```javascript
msg.operation = "read";
msg.dataType = "DM";
msg.address = "100.05";
msg.count = 1;
return msg; // Returns single boolean value
```

**Write values to DM200:**
```javascript
msg.operation = "write";
msg.dataType = "DM";
msg.address = "200";
msg.payload = [100, 200, 300];
return msg;
```

**Multi-address read:**
```javascript
msg.operation = "read";
msg.dataType = "DM";  // Default for strings/objects without dataType
msg.address = [
    "1000",                                    // Read 1 word from DM1000
    {address: "200", count: 5},               // Read 5 words from DM200
    {address: "300", dataType: "CIO", count: 2} // Read 2 words from CIO300
];
return msg;
// Output: [{address: "1000", dataType: "DM", value: [...]}, ...]
```

### omron-fins-udp (UDP)

A node for reading and writing data to/from Omron PLCs using the FINS protocol over UDP/IP.

#### When to use UDP
- High-speed polling and monitoring applications
- Low-latency requirements
- Applications where occasional data loss is acceptable
- No persistent connection overhead needed

#### Configuration

- **Connection**: Reference to an omron-fins-udp-config node
- **Input Mode**: Controls parameter source
  - **Use Node Settings** (default): Uses the configured operation, data type, and address from the node settings
  - **Use Input Message**: Reads all parameters from the input message (msg.operation, msg.dataType, msg.address, etc.)
- **Operation**: Read or Write operation (only used when Input Mode is "Use Node Settings")
- **Data Type**: Memory area type (CIO, WR, HR, AR, DM, EM)
- **Address**: Memory address to access (supports bit notation like "100.05" for bit 5 of word 100)

#### UDP vs TCP Differences

| Feature         | UDP                     | TCP                       |
| --------------- | ----------------------- | ------------------------- |
| Connection      | Connectionless          | Connection-oriented       |
| Handshake       | None                    | FINS/TCP handshake        |
| Reliability     | Best-effort delivery    | Guaranteed delivery       |
| Speed           | Faster (no handshake)   | Slower (connection setup) |
| Retry Logic     | Built-in (configurable) | TCP layer handles it      |
| Typical Timeout | 1000ms                  | 5000ms                    |
| Use Case        | High-speed polling      | Critical operations       |

The UDP node includes automatic retry logic with configurable retry counts, making it suitable for real-time applications where speed is more important than absolute reliability.

#### Input & Output

The omron-fins-udp node accepts the same input message format and produces the same output format as the omron-fins (TCP) node. See the TCP node documentation above for details on:
- Input message properties
- Data format options
- Output message structure
- Usage examples

### omron-fins-config (TCP Connection)

Configuration node for Omron FINS TCP connection settings.

#### Properties

- **Host**: IP address or hostname of the Omron PLC
- **Port**: FINS TCP port number (default: 9600)
- **PLC Node**: PLC node number (default: 0) - Check your PLC's FINS node settings
- **PC Node**: PC node number (default: 0) - Use 0 for automatic assignment
- **Timeout**: Connection timeout in milliseconds (default: 5000)

**Advanced (rarely needed):**
- **Dest Network**: Destination network address (default: 0 for local network)
- **Source Network**: Source network address (default: 0 for local network)

**Note:** For typical single-network setups, you only need to configure the Host IP. Leave all node numbers at 0.

### omron-fins-udp-config (UDP Connection)

Configuration node for Omron FINS UDP connection settings.

#### Properties

- **Host**: IP address or hostname of the Omron PLC
- **Port**: FINS UDP port number (default: 9600)
- **PLC Node**: PLC node number (default: 0) - Check your PLC's FINS node settings
- **PC Node**: PC node number (default: 0)
- **Local Port**: UDP source port (default: 0 for automatic assignment)
- **Timeout**: UDP response timeout in milliseconds (default: 1000)
- **Retries**: Number of retry attempts on timeout (default: 3)

**Advanced (rarely needed):**
- **Dest Network**: Destination network address (default: 0 for local network)
- **Source Network**: Source network address (default: 0 for local network)

**Note:** UDP uses a shorter default timeout (1000ms vs 5000ms for TCP) and includes built-in retry logic to compensate for the unreliable nature of UDP transport. For typical single-network setups, you only need to configure the Host IP and leave all node numbers at 0.

## Supported Memory Areas

| Code | Description          |
| ---- | -------------------- |
| CIO  | Core I/O area        |
| WR   | Work area            |
| HR   | Holding area         |
| AR   | Auxiliary area       |
| DM   | Data memory area     |
| EM   | Extended memory area |

## Requirements

- Node.js >= 14.0.0
- Node-RED >= 2.0.0

## Development

### Project Structure
```
node-red-lib-comm-omron-fins/
├── package.json
├── omron-fins.js              # TCP node runtime
├── omron-fins.html            # TCP node editor UI
├── omron-fins-config.js       # TCP config node runtime
├── omron-fins-config.html     # TCP config node editor UI
├── omron-fins-udp.js          # UDP node runtime
├── omron-fins-udp.html        # UDP node editor UI
├── omron-fins-udp-config.js   # UDP config node runtime
├── omron-fins-udp-config.html # UDP config node editor UI
├── README.md
└── LICENSE
```

### Testing

To test the nodes locally:

1. Link the package to your Node-RED installation:
```bash
cd ~/.node-red
npm install /path/to/node-red-lib-comm-omron-fins
```

2. Restart Node-RED

3. The nodes should appear in the palette under the "MACHHUB Comms" category

## License

Apache-2.0

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This is a basic implementation of the FINS protocol. For production use, you may want to:
- Add more comprehensive error handling
- Implement the complete FINS protocol specification
- Add support for more memory areas and data types
- Add unit tests
- Implement connection pooling for better performance

## Support

For issues and feature requests, please use the GitHub issue tracker.
