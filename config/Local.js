module.exports = {
    solc:{
        solcBinRepo: './solc-repo/bin',
        solcJsRepo: './solc-repo/js',
    },
    mysql: {
        host: '127.0.0.1',
        port: 3306,
        username: 'root',
        password: '',
        database: 'verification',
        dialect: 'mysql',
        syncSchema: true,
        readonly : false,
        logging: false,
    },
};