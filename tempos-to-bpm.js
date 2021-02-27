let tempos = {
    larghissimo: 24,
    hrave: 30,
    largo: 50,
    lento: 55,
    larghetto: 63,
    adagio: 70,
    adagietto: 72,
    andante: 85,
    andantino: 90,
    "marcia moderato": 84,
    "andante moderato": 95,
    moderato: 115,
    allegretto: 115,
    "allegro moderato": 120,
    allegro: 135,
    vivace: 165,
    vivacissimo: 175,
    allegrissimo: 174,
    presto: 180,
    prestissimo: 200
}

module.exports = (tempo) => {
    if (!isNaN(parseInt(tempo))) return parseInt(tempo) // sometimes tempo is just a bpm

    return tempos[tempo.toLowerCase()]
}