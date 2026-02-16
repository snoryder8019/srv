// Claude Test Route
module.exports = function(app) {
    app.get('/claudeTest', (req, res) => {
        res.render('claudeTest/index');
    });
};