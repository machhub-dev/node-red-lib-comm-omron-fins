module.exports = function (RED) {
    function OmronFinsUdpConfigNode(config) {
        RED.nodes.createNode(this, config);

        this.host = config.host;
        this.port = config.port || 9600;
        this.localPort = config.localPort || 0; // 0 = auto-assign
        this.DA1 = config.DA1 || 0;
        this.DA2 = config.DA2 || 0;
        this.SA1 = config.SA1 || 0;
        this.SA2 = config.SA2 || 0;
        this.timeout = config.timeout || 1000; // Shorter timeout for UDP
        this.retries = config.retries || 3;
    }

    RED.nodes.registerType("omron-fins-udp-config", OmronFinsUdpConfigNode);
};
