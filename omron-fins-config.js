module.exports = function (RED) {
    function OmronFinsConfigNode(config) {
        RED.nodes.createNode(this, config);

        this.host = config.host;
        this.port = config.port || 9600;
        this.DA1 = config.DA1 || 0;
        this.DA2 = config.DA2 || 0;
        this.SA1 = config.SA1 || 0;
        this.SA2 = config.SA2 || 0;
        this.timeout = config.timeout || 5000;
    }

    RED.nodes.registerType("omron-fins-config", OmronFinsConfigNode);
};
